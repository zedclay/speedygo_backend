import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { MerchantSettlementService } from '../../merchant-settlements/application/merchant-settlement.service';
import { NotificationService } from '../../notifications/application/notification.service';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminAuditService } from './admin-audit.service';

/**
 * Settlement ≠ payout. No PAID transition in Admin Foundation v1.0.
 * Domain mutation and AuditLog commit in ONE DB transaction; audit failure rolls back.
 * Finalize notifications run only after that outer TX commits.
 */
@Injectable()
export class AdminSettlementCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: MerchantSettlementService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationService,
  ) {}

  async openDraft(
    admin: CurrentAdminContext,
    input: { merchantId: string; periodStart: string; periodEnd: string },
  ) {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.settlements.openDraftInTx(tx, {
        ...input,
        adminId: admin.adminProfileId,
      });
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.SETTLEMENT_OPEN_DRAFT,
        targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT_SETTLEMENT,
        targetId: result.id,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async buildSaleLines(admin: CurrentAdminContext, settlementId: string) {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.settlements.buildSaleLinesInTx(tx, {
        settlementId,
        adminId: admin.adminProfileId,
      });
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.SETTLEMENT_BUILD_SALE_LINES,
        targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT_SETTLEMENT,
        targetId: settlementId,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async attachRefundLiability(
    admin: CurrentAdminContext,
    input: {
      settlementId: string;
      refundId: string;
      merchantLiabilityMinor: number;
    },
  ) {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.settlements.attachRefundAdjustmentInTx(tx, {
        ...input,
        adminId: admin.adminProfileId,
      });
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.SETTLEMENT_ATTACH_REFUND_LIABILITY,
        targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT_SETTLEMENT,
        targetId: input.settlementId,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async finalize(admin: CurrentAdminContext, settlementId: string) {
    const result = await this.prisma.getDb().transaction(async (tx) => {
      const settlement = await this.settlements.finalizeInTx(tx, {
        settlementId,
        adminId: admin.adminProfileId,
      });
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.SETTLEMENT_FINALIZE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT_SETTLEMENT,
        targetId: settlementId,
        afterJson: settlement,
        sessionId: admin.sessionId,
      });
      return settlement;
    });
    await this.notifications.notifySettlementFinalized({
      settlementId: result.id,
      merchantId: result.merchantId,
    });
    return result;
  }
}
