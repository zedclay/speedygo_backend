import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/database.module';
import {
  AdminAuditService,
  type OrmClient,
} from '../../admin/application/admin-audit.service';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../../admin/domain/admin-audit-actions';
import type { CurrentAdminContext } from '../../admin/domain/admin.types';
import { validateAdminPolygonInput } from '../domain/delivery-zone.policy';
import type { DeliveryZoneRecord } from '../domain/delivery-pricing.types';
import { DeliveryZoneRepository } from '../infrastructure/delivery-zone.repository';
import { DeliveryZoneService } from './delivery-zone.service';

export type CreateZoneCommand = {
  name: string;
  rawGeometry: unknown;
};

export type UpdateZoneCommand = {
  id: string;
  name?: string;
  rawGeometry?: unknown;
};

/**
 * Admin commands for DeliveryZone with atomic AuditLog in the same DB transaction.
 * Idempotent activate/deactivate/identical-update skip AuditLog (no misleading change).
 */
@Injectable()
export class AdminDeliveryZoneCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly zoneService: DeliveryZoneService,
    private readonly zoneRepo: DeliveryZoneRepository,
    private readonly audit: AdminAuditService,
  ) {}

  async create(
    admin: CurrentAdminContext,
    cmd: CreateZoneCommand,
  ): Promise<DeliveryZoneRecord> {
    const polygon = validateAdminPolygonInput(cmd.rawGeometry);
    return this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const zone = await this.zoneService.createZoneInTx(tx, {
        name: cmd.name,
        polygon,
      });
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.DELIVERY_ZONE_CREATE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.DELIVERY_ZONE,
        targetId: zone.id,
        afterJson: zone,
        sessionId: admin.sessionId,
      });
      return zone;
    });
  }

  async update(
    admin: CurrentAdminContext,
    cmd: UpdateZoneCommand,
  ): Promise<DeliveryZoneRecord> {
    const polygon =
      cmd.rawGeometry !== undefined
        ? validateAdminPolygonInput(cmd.rawGeometry)
        : undefined;
    return this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const before = await this.zoneRepo.requireById(cmd.id, tx);
      const result = await this.zoneService.updateZoneInTx(tx, {
        id: cmd.id,
        name: cmd.name,
        polygon,
      });
      if (result.mutated) {
        await this.audit.recordInTx(tx, {
          adminId: admin.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.DELIVERY_ZONE_UPDATE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.DELIVERY_ZONE,
          targetId: result.zone.id,
          beforeJson: before,
          afterJson: result.zone,
          sessionId: admin.sessionId,
        });
      }
      return result.zone;
    });
  }

  async activate(
    admin: CurrentAdminContext,
    zoneId: string,
  ): Promise<DeliveryZoneRecord> {
    return this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const result = await this.zoneService.activateZoneInTx(tx, zoneId);
      if (result.mutated) {
        await this.audit.recordInTx(tx, {
          adminId: admin.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.DELIVERY_ZONE_ACTIVATE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.DELIVERY_ZONE,
          targetId: result.zone.id,
          afterJson: result.zone,
          sessionId: admin.sessionId,
        });
      }
      return result.zone;
    });
  }

  async deactivate(
    admin: CurrentAdminContext,
    zoneId: string,
  ): Promise<DeliveryZoneRecord> {
    return this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const result = await this.zoneService.deactivateZoneInTx(tx, zoneId);
      if (result.mutated) {
        await this.audit.recordInTx(tx, {
          adminId: admin.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.DELIVERY_ZONE_DEACTIVATE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.DELIVERY_ZONE,
          targetId: result.zone.id,
          afterJson: result.zone,
          sessionId: admin.sessionId,
        });
      }
      return result.zone;
    });
  }
}
