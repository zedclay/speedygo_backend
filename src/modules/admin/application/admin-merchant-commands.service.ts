import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { MerchantReviewService } from '../../merchants/application/merchant-review.service';
import type { MerchantView } from '../../merchants/domain/merchant.types';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminAuditService } from './admin-audit.service';

/**
 * Audit atomicity policy (Admin Foundation v1.0):
 * Domain mutation and AuditLog insert commit in ONE DB transaction.
 * Audit failure rolls back the mutation — no durable change without audit.
 */
@Injectable()
export class AdminMerchantCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantReview: MerchantReviewService,
    private readonly audit: AdminAuditService,
  ) {}

  async approveVerification(
    admin: CurrentAdminContext,
    merchantId: string,
  ): Promise<MerchantView> {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.merchantReview.approveInTx(tx, {
        merchantId,
        adminId: admin.adminProfileId,
      });
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.MERCHANT_VERIFICATION_APPROVE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT,
        targetId: merchantId,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async rejectVerification(
    admin: CurrentAdminContext,
    merchantId: string,
  ): Promise<MerchantView> {
    // Rejection reason is intentionally not accepted or persisted in v1.0.
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.merchantReview.rejectInTx(tx, {
        merchantId,
        adminId: admin.adminProfileId,
      });
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.MERCHANT_VERIFICATION_REJECT,
        targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT,
        targetId: merchantId,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async suspend(
    admin: CurrentAdminContext,
    merchantId: string,
  ): Promise<MerchantView> {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.merchantReview.suspendInTx(tx, {
        merchantId,
        adminId: admin.adminProfileId,
      });
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.MERCHANT_SUSPEND,
        targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT,
        targetId: merchantId,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }
}
