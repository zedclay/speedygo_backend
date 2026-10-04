import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { PromotionService } from '../../promotions/application/promotion.service';
import type { CreatePromotionInput } from '../../promotions/domain/promotion.types';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminAuditService } from './admin-audit.service';

/**
 * Domain mutation and AuditLog commit in ONE DB transaction; audit failure rolls back.
 */
@Injectable()
export class AdminPromotionCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: PromotionService,
    private readonly audit: AdminAuditService,
  ) {}

  async create(admin: CurrentAdminContext, input: CreatePromotionInput) {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.promotions.createPromotionInTx(tx, input);
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.PROMOTION_CREATE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.PROMOTION,
        targetId: result.id,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async activate(admin: CurrentAdminContext, promotionId: string) {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.promotions.setPromotionActiveInTx(
        tx,
        promotionId,
        true,
      );
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.PROMOTION_ACTIVATE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.PROMOTION,
        targetId: promotionId,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async deactivate(admin: CurrentAdminContext, promotionId: string) {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.promotions.setPromotionActiveInTx(
        tx,
        promotionId,
        false,
      );
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.PROMOTION_DEACTIVATE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.PROMOTION,
        targetId: promotionId,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async publishDiscovery(
    admin: CurrentAdminContext,
    promotionId: string,
    customerLabel?: string | null,
  ) {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.promotions.setPromotionDiscoverableInTx(
        tx,
        promotionId,
        true,
        customerLabel,
      );
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.PROMOTION_PUBLISH_DISCOVERY,
        targetType: ADMIN_AUDIT_TARGET_TYPES.PROMOTION,
        targetId: promotionId,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async hideDiscovery(admin: CurrentAdminContext, promotionId: string) {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.promotions.setPromotionDiscoverableInTx(
        tx,
        promotionId,
        false,
      );
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.PROMOTION_HIDE_DISCOVERY,
        targetType: ADMIN_AUDIT_TARGET_TYPES.PROMOTION,
        targetId: promotionId,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async updatePresentation(
    admin: CurrentAdminContext,
    promotionId: string,
    customerLabel?: string | null,
  ) {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.promotions.setPromotionPresentationInTx(
        tx,
        promotionId,
        customerLabel,
      );
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.PROMOTION_UPDATE_PRESENTATION,
        targetType: ADMIN_AUDIT_TARGET_TYPES.PROMOTION,
        targetId: promotionId,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }
}
