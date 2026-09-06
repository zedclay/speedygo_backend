import { Injectable } from '@nestjs/common';
import { moneyMinorToDecimalString } from '../../../common/money/money-minor';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { MerchantSettlementService } from '../../merchant-settlements/application/merchant-settlement.service';
import type {
  MerchantSettlementLineRecord,
  MerchantSettlementRecord,
} from '../../merchant-settlements/domain/merchant-settlement.types';
import { NotificationService } from '../../notifications/application/notification.service';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminAuditService } from './admin-audit.service';

/** JSON-safe settlement payload (money as exact decimal strings). */
function settlementRecordForApi(row: MerchantSettlementRecord) {
  return {
    id: row.id,
    merchantId: row.merchantId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    status: row.status,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
    grossSalesMinor: moneyMinorToDecimalString(row.grossSalesMinor),
    commissionMinor: moneyMinorToDecimalString(row.commissionMinor),
    refundAdjustmentsMinor: moneyMinorToDecimalString(
      row.refundAdjustmentsMinor,
    ),
    manualAdjustmentsMinor: moneyMinorToDecimalString(
      row.manualAdjustmentsMinor,
    ),
    netPayableMinor: moneyMinorToDecimalString(row.netPayableMinor),
  };
}

function settlementLineForApi(row: MerchantSettlementLineRecord) {
  return {
    id: row.id,
    settlementId: row.settlementId,
    orderId: row.orderId,
    type: row.type,
    reference: row.reference,
    createdAt: row.createdAt,
    grossMerchandiseMinor: moneyMinorToDecimalString(row.grossMerchandiseMinor),
    commissionMinor: moneyMinorToDecimalString(row.commissionMinor),
    merchantNetMinor: moneyMinorToDecimalString(row.merchantNetMinor),
    adjustmentMinor: moneyMinorToDecimalString(row.adjustmentMinor),
  };
}

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
      const api = settlementRecordForApi(result);
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.SETTLEMENT_OPEN_DRAFT,
        targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT_SETTLEMENT,
        targetId: result.id,
        afterJson: api,
        sessionId: admin.sessionId,
      });
      return api;
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
      const api = result ? settlementLineForApi(result) : null;
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.SETTLEMENT_ATTACH_REFUND_LIABILITY,
        targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT_SETTLEMENT,
        targetId: input.settlementId,
        afterJson: api,
        sessionId: admin.sessionId,
      });
      return api;
    });
  }

  async finalize(admin: CurrentAdminContext, settlementId: string) {
    const result = await this.prisma.getDb().transaction(async (tx) => {
      const settlement = await this.settlements.finalizeInTx(tx, {
        settlementId,
        adminId: admin.adminProfileId,
      });
      const api = settlementRecordForApi(settlement);
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.SETTLEMENT_FINALIZE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT_SETTLEMENT,
        targetId: settlementId,
        afterJson: api,
        sessionId: admin.sessionId,
      });
      return { settlement, api };
    });
    await this.notifications.notifySettlementFinalized({
      settlementId: result.settlement.id,
      merchantId: result.settlement.merchantId,
    });
    return result.api;
  }
}
