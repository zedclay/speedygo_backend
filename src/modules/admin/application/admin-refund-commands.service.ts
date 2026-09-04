import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { NotificationService } from '../../notifications/application/notification.service';
import {
  RefundService,
  type CreateRefundCommand,
} from '../../refunds/application/refund.service';
import type { RefundRecord } from '../../refunds/domain/refund.types';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminAuditService } from './admin-audit.service';

/**
 * requestedByAdminId / adminId ALWAYS come from CurrentAdmin — never from body.
 * ORIGINAL_PAYMENT is rejected by RefundService (no provider execution in v1.0).
 * confirmManualRefund is the SOP path for MANUAL_COD / MANUAL_OTHER after approve.
 *
 * Domain mutation and AuditLog commit in ONE DB transaction; audit failure rolls back.
 * Notifications run only after that outer TX commits.
 */
@Injectable()
export class AdminRefundCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refunds: RefundService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationService,
  ) {}

  async create(
    admin: CurrentAdminContext,
    input: Omit<CreateRefundCommand, 'requestedByAdminId'>,
  ): Promise<RefundRecord> {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.refunds.createRefundInTx(tx, {
        ...input,
        requestedByAdminId: admin.adminProfileId,
      });
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.REFUND_CREATE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.REFUND,
        targetId: result.id,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async approve(
    admin: CurrentAdminContext,
    refundId: string,
    internalNote?: string | null,
  ): Promise<RefundRecord> {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.refunds.authorizeRefundInTx(tx, refundId, {
        adminId: admin.adminProfileId,
        internalNote,
      });
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.REFUND_APPROVE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.REFUND,
        targetId: refundId,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async reject(
    admin: CurrentAdminContext,
    refundId: string,
    internalNote?: string | null,
  ): Promise<RefundRecord> {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.refunds.rejectRefundInTx(tx, refundId, {
        adminId: admin.adminProfileId,
        internalNote,
      });
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.REFUND_REJECT,
        targetType: ADMIN_AUDIT_TARGET_TYPES.REFUND,
        targetId: refundId,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  /**
   * SOP: authorize → finance executes off-platform → confirmManualRefund.
   * Does not call provider ORIGINAL_PAYMENT execution.
   */
  async confirmManual(
    admin: CurrentAdminContext,
    refundId: string,
    internalNote?: string | null,
  ): Promise<RefundRecord> {
    const result = await this.prisma.getDb().transaction(async (tx) => {
      const refund = await this.refunds.confirmManualRefundInTx(tx, refundId, {
        adminId: admin.adminProfileId,
        internalNote,
      });
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.REFUND_CONFIRM_MANUAL,
        targetType: ADMIN_AUDIT_TARGET_TYPES.REFUND,
        targetId: refundId,
        afterJson: refund,
        sessionId: admin.sessionId,
      });
      return refund;
    });
    await this.notifications.notifyRefundRefunded({ refundId: result.id });
    return result;
  }
}
