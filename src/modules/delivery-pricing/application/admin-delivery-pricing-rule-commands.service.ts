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
import type {
  CreateDeliveryPricingRuleInput,
  DeliveryPricingRuleRecord,
} from '../domain/delivery-pricing.types';
import { DeliveryPricingRuleService } from './delivery-pricing-rule.service';

/**
 * Admin commands for DeliveryPricingRule with atomic AuditLog in the same DB transaction.
 * Idempotent activate/deactivate skip AuditLog.
 */
@Injectable()
export class AdminDeliveryPricingRuleCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleService: DeliveryPricingRuleService,
    private readonly audit: AdminAuditService,
  ) {}

  async create(
    admin: CurrentAdminContext,
    input: CreateDeliveryPricingRuleInput,
  ): Promise<DeliveryPricingRuleRecord> {
    return this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const rule = await this.ruleService.createRuleInTx(tx, input);
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.DELIVERY_PRICING_RULE_CREATE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.DELIVERY_PRICING_RULE,
        targetId: rule.id,
        afterJson: serializeRule(rule),
        sessionId: admin.sessionId,
      });
      return rule;
    });
  }

  async activate(
    admin: CurrentAdminContext,
    ruleId: string,
  ): Promise<DeliveryPricingRuleRecord> {
    return this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const result = await this.ruleService.activateRuleInTx(tx, ruleId);
      if (result.mutated) {
        await this.audit.recordInTx(tx, {
          adminId: admin.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.DELIVERY_PRICING_RULE_ACTIVATE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.DELIVERY_PRICING_RULE,
          targetId: result.rule.id,
          afterJson: serializeRule(result.rule),
          sessionId: admin.sessionId,
        });
      }
      return result.rule;
    });
  }

  async deactivate(
    admin: CurrentAdminContext,
    ruleId: string,
  ): Promise<DeliveryPricingRuleRecord> {
    return this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const result = await this.ruleService.deactivateRuleInTx(tx, ruleId);
      if (result.mutated) {
        await this.audit.recordInTx(tx, {
          adminId: admin.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.DELIVERY_PRICING_RULE_DEACTIVATE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.DELIVERY_PRICING_RULE,
          targetId: result.rule.id,
          afterJson: serializeRule(result.rule),
          sessionId: admin.sessionId,
        });
      }
      return result.rule;
    });
  }
}

function serializeRule(
  rule: DeliveryPricingRuleRecord,
): Record<string, unknown> {
  return {
    ...rule,
    customerDeliveryFeeMinor: rule.customerDeliveryFeeMinor.toString(),
    driverRemunerationMinor: rule.driverRemunerationMinor.toString(),
  };
}
