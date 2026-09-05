import { Injectable } from '@nestjs/common';
import { AdminAuditService } from '../../admin/application/admin-audit.service';
import { ADMIN_AUDIT_TARGET_TYPES } from '../../admin/domain/admin-audit-actions';
import type { CurrentAdminContext } from '../../admin/domain/admin.types';
import { listSettingDefinitions } from '../domain/settings.registry';
import {
  normalizeIncomingValue,
  parseStoredEnvelope,
  requireAllowlistedDefinition,
  toSettingView,
  toStoredEnvelope,
  valuesEqual,
} from '../domain/settings.policy';
import type { SettingView } from '../domain/settings.types';
import { SettingsRepository } from '../infrastructure/settings.repository';

@Injectable()
export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly audit: AdminAuditService,
  ) {}

  async listSettings(): Promise<SettingView[]> {
    const defs = listSettingDefinitions();
    const rows = await this.repo.findAllowlisted(defs.map((d) => d.key));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return defs.map((def) => {
      const row = byKey.get(def.key);
      if (!row) {
        return toSettingView({
          def,
          value: def.defaultValue,
          source: 'APPLICATION_DEFAULT',
          updatedAt: null,
        });
      }
      const value = parseStoredEnvelope(def, row.valueJson);
      return toSettingView({
        def,
        value,
        source: 'DATABASE',
        updatedAt: row.updatedAt,
      });
    });
  }

  async getSetting(key: string): Promise<SettingView> {
    const def = requireAllowlistedDefinition(key);
    const row = await this.repo.findByKey(key);
    if (!row) {
      return toSettingView({
        def,
        value: def.defaultValue,
        source: 'APPLICATION_DEFAULT',
        updatedAt: null,
      });
    }
    const value = parseStoredEnvelope(def, row.valueJson);
    return toSettingView({
      def,
      value,
      source: 'DATABASE',
      updatedAt: row.updatedAt,
    });
  }

  /**
   * Upsert allowlisted PlatformSetting + AuditLog in one TX.
   * Idempotent when normalized value equals current effective value (no write, no audit).
   * Concurrent Admins serialize via advisory lock; last committed update wins.
   * Actor is CurrentAdmin.adminProfileId (persisted on the row; not exposed in SettingView).
   */
  async updateSetting(
    admin: CurrentAdminContext,
    key: string,
    rawValue: unknown,
  ): Promise<SettingView> {
    const def = requireAllowlistedDefinition(key);
    const nextValue = normalizeIncomingValue(def, rawValue);

    return this.repo.runInTransaction(async (tx) => {
      await this.repo.lockKeyInTx(tx, key);
      const existing = await this.repo.findByKeyInTx(tx, key);
      const currentValue = existing
        ? parseStoredEnvelope(def, existing.valueJson)
        : def.defaultValue;

      if (valuesEqual(currentValue, nextValue)) {
        if (!existing) {
          return toSettingView({
            def,
            value: currentValue,
            source: 'APPLICATION_DEFAULT',
            updatedAt: null,
          });
        }
        return toSettingView({
          def,
          value: currentValue,
          source: 'DATABASE',
          updatedAt: existing.updatedAt,
        });
      }

      const envelope = toStoredEnvelope(nextValue);
      const row = existing
        ? await this.repo.updateValueInTx(tx, {
            id: existing.id,
            valueJson: envelope,
            updatedByAdminId: admin.adminProfileId,
          })
        : await this.repo.createInTx(tx, {
            key,
            valueJson: envelope,
            updatedByAdminId: admin.adminProfileId,
          });

      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: def.auditAction,
        targetType: ADMIN_AUDIT_TARGET_TYPES.PLATFORM_SETTING,
        targetId: row.id,
        beforeJson: {
          key,
          value: currentValue,
          source: existing ? 'DATABASE' : 'APPLICATION_DEFAULT',
        },
        afterJson: {
          key,
          value: nextValue,
          source: 'DATABASE',
        },
        sessionId: admin.sessionId,
      });

      return toSettingView({
        def,
        value: nextValue,
        source: 'DATABASE',
        updatedAt: row.updatedAt,
      });
    });
  }
}
