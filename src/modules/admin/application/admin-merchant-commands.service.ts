import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { SessionService } from '../../auth/application/session.service';
import { MerchantReviewService } from '../../merchants/application/merchant-review.service';
import type { MerchantView } from '../../merchants/domain/merchant.types';
import { MerchantRepository } from '../../merchants/infrastructure/merchant.repository';
import { TrackingGateway } from '../../tracking/infrastructure/tracking.gateway';
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
 *
 * P1-G: Merchant suspend also revokes every active Session for each
 * MerchantMember Account in the same TX. Redis + Socket.IO cleanup runs
 * after commit; Session.revokedAt remains authoritative.
 */
@Injectable()
export class AdminMerchantCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantReview: MerchantReviewService,
    private readonly merchants: MerchantRepository,
    private readonly sessions: SessionService,
    private readonly tracking: TrackingGateway,
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
    const committed = await this.prisma.getDb().transaction(async (tx) => {
      const result = await this.merchantReview.suspendInTx(tx, {
        merchantId,
        adminId: admin.adminProfileId,
      });
      const memberAccountIds = await this.merchants.listMemberAccountIds(
        merchantId,
        tx,
      );
      const revokedSessionIds: string[] = [];
      for (const accountId of memberAccountIds) {
        const ids = await this.sessions.revokeAllSessionsForAccountInTx(
          tx,
          accountId,
        );
        revokedSessionIds.push(...ids);
      }
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.MERCHANT_SUSPEND,
        targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT,
        targetId: merchantId,
        afterJson: {
          id: result.id,
          status: result.status,
          alreadySuspended: result.alreadySuspended,
          affectedAccountCount: memberAccountIds.length,
          sessionsRevoked: revokedSessionIds.length,
        },
        sessionId: admin.sessionId,
      });
      const { alreadySuspended: _already, ...view } = result;
      return { view, revokedSessionIds, memberAccountIds };
    });

    await this.sessions.finalizeSessionRevocations(
      committed.memberAccountIds,
      committed.revokedSessionIds,
    );
    this.tracking.disconnectSessions(committed.revokedSessionIds);
    return committed.view;
  }
}
