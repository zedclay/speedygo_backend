import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { SessionService } from '../../auth/application/session.service';
import { PermissionService } from '../../authorization/permission.service';
import { TrackingGateway } from '../../tracking/infrastructure/tracking.gateway';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import {
  adminCustomerAccountConflict,
  adminForbidden,
  adminInvalidInput,
  adminNotFound,
} from '../domain/admin.errors';
import type {
  AdminCustomerColocated,
  AdminCustomerLifecycleResult,
  CurrentAdminContext,
} from '../domain/admin.types';
import { AdminRbacRepository } from '../infrastructure/admin-rbac.repository';
import { AdminAuditService } from './admin-audit.service';

const ACCOUNT_ACTIVE = 'ACTIVE';
const ACCOUNT_SUSPENDED = 'SUSPENDED';
const ACCOUNT_DISABLED = 'DISABLED';
const AUDIT_NOTE_MAX = 2000;

type LifecycleMode = 'suspend' | 'reactivate';

/**
 * Customer lifecycle is Account.status (Account-wide), not CustomerProfile.status.
 * Shared Admin Accounts must use Admin RBAC — this path refuses hasAdminProfile.
 */
@Injectable()
export class AdminCustomerCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacRepo: AdminRbacRepository,
    private readonly sessions: SessionService,
    private readonly permissions: PermissionService,
    private readonly tracking: TrackingGateway,
    private readonly audit: AdminAuditService,
  ) {}

  async suspend(
    admin: CurrentAdminContext,
    customerId: string,
    auditNote?: string,
  ): Promise<AdminCustomerLifecycleResult> {
    return this.mutateLifecycle(admin, customerId, 'suspend', auditNote);
  }

  async reactivate(
    admin: CurrentAdminContext,
    customerId: string,
    auditNote?: string,
  ): Promise<AdminCustomerLifecycleResult> {
    return this.mutateLifecycle(admin, customerId, 'reactivate', auditNote);
  }

  private normalizeAuditNote(raw?: string): string | null {
    if (raw === undefined || raw === null) return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > AUDIT_NOTE_MAX) {
      throw adminInvalidInput(
        `auditNote must be at most ${AUDIT_NOTE_MAX} characters`,
      );
    }
    return trimmed;
  }

  private async loadColocated(
    client: { orm: SpeedyGoDb['orm'] },
    accountId: string,
  ): Promise<AdminCustomerColocated> {
    const db = client.orm.public;
    const [adminRow, driver, member] = await Promise.all([
      db.AdminProfile.where({ accountId }).first(),
      db.DriverProfile.where({ accountId }).first(),
      db.MerchantMember.where({ accountId }).first(),
    ]);
    return {
      hasAdminProfile: Boolean(adminRow),
      hasDriverProfile: Boolean(driver),
      hasMerchantMembership: Boolean(member),
    };
  }

  private async mutateLifecycle(
    admin: CurrentAdminContext,
    customerId: string,
    mode: LifecycleMode,
    auditNoteRaw?: string,
  ): Promise<AdminCustomerLifecycleResult> {
    const auditNote = this.normalizeAuditNote(auditNoteRaw);
    const targetStatus =
      mode === 'suspend' ? ACCOUNT_SUSPENDED : ACCOUNT_ACTIVE;

    const committed = await this.prisma.getDb().transaction(async (tx) => {
      const customer = await tx.orm.public.CustomerProfile.where({
        id: customerId,
      }).first();
      if (!customer) {
        throw adminNotFound('Customer not found');
      }

      if (customer.accountId === admin.accountId) {
        throw adminForbidden(
          'Cannot change Account.status for your own Account via customer routes',
        );
      }

      const account = await tx.orm.public.Account.where({
        id: customer.accountId,
      }).first();
      if (!account) {
        throw adminNotFound('Customer account not found');
      }

      const colocated = await this.loadColocated(tx, customer.accountId);
      if (colocated.hasAdminProfile) {
        throw adminCustomerAccountConflict(
          'This Account has an AdminProfile — use Admin RBAC Account.status (admins.manage); customer routes cannot bypass lockout/delegation protections',
        );
      }

      if (account.status === ACCOUNT_DISABLED) {
        throw adminCustomerAccountConflict(
          'DISABLED Accounts are out of scope for customer suspend/reactivate',
        );
      }

      if (mode === 'suspend' && account.status === ACCOUNT_SUSPENDED) {
        return {
          result: {
            customerId: customer.id,
            accountId: customer.accountId,
            accountStatus: ACCOUNT_SUSPENDED,
            alreadyApplied: true,
            sessionsRevoked: 0,
            colocated,
          } satisfies AdminCustomerLifecycleResult,
          revokedSessionIds: [] as string[],
          accountId: customer.accountId,
        };
      }

      if (mode === 'reactivate' && account.status === ACCOUNT_ACTIVE) {
        return {
          result: {
            customerId: customer.id,
            accountId: customer.accountId,
            accountStatus: ACCOUNT_ACTIVE,
            alreadyApplied: true,
            sessionsRevoked: 0,
            colocated,
          } satisfies AdminCustomerLifecycleResult,
          revokedSessionIds: [] as string[],
          accountId: customer.accountId,
        };
      }

      if (mode === 'reactivate' && account.status !== ACCOUNT_SUSPENDED) {
        throw adminCustomerAccountConflict(
          `Cannot reactivate Account with status ${account.status}`,
        );
      }

      if (mode === 'suspend' && account.status !== ACCOUNT_ACTIVE) {
        throw adminCustomerAccountConflict(
          `Cannot suspend Account with status ${account.status}`,
        );
      }

      const beforeStatus = account.status;
      await this.rbacRepo.updateAccountStatusInTx(
        tx,
        customer.accountId,
        targetStatus,
      );

      let revokedSessionIds: string[] = [];
      if (beforeStatus === ACCOUNT_ACTIVE && targetStatus !== ACCOUNT_ACTIVE) {
        revokedSessionIds = await this.sessions.revokeAllSessionsForAccountInTx(
          tx,
          customer.accountId,
        );
      }

      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action:
          mode === 'suspend'
            ? ADMIN_AUDIT_ACTIONS.CUSTOMER_ACCOUNT_SUSPEND
            : ADMIN_AUDIT_ACTIONS.CUSTOMER_ACCOUNT_REACTIVATE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.CUSTOMER,
        targetId: customer.id,
        beforeJson: { accountStatus: beforeStatus },
        afterJson: {
          accountId: customer.accountId,
          accountStatus: targetStatus,
          alreadyApplied: false,
          sessionsRevoked: revokedSessionIds.length,
          colocated,
          auditNote,
          scope:
            'Account.status is Account-wide (Customer + co-located Driver/MerchantMember). Orders/Deliveries not auto-cancelled.',
        },
        sessionId: admin.sessionId,
      });

      return {
        result: {
          customerId: customer.id,
          accountId: customer.accountId,
          accountStatus: targetStatus,
          alreadyApplied: false,
          sessionsRevoked: revokedSessionIds.length,
          colocated,
        } satisfies AdminCustomerLifecycleResult,
        revokedSessionIds,
        accountId: customer.accountId,
      };
    });

    if (committed.revokedSessionIds.length > 0) {
      await this.sessions.finalizeSessionRevocations(
        [committed.accountId],
        committed.revokedSessionIds,
      );
      this.tracking.disconnectSessions(committed.revokedSessionIds);
    }
    await this.permissions.invalidate(committed.accountId);
    return committed.result;
  }
}
