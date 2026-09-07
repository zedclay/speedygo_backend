import { Module } from '@nestjs/common';
import { DeliveryPricingRuleService } from './application/delivery-pricing-rule.service';
import { DeliveryZoneService } from './application/delivery-zone.service';
import { DeliveryPricingRuleRepository } from './infrastructure/delivery-pricing-rule.repository';
import { DeliveryZoneRepository } from './infrastructure/delivery-zone.repository';

/**
 * Delivery Zone + Pricing Rule domain module.
 * Admin HTTP controllers and audited command services live in AdminModule
 * (single AdminAuditService instance for spy/rollback e2e parity with promotions).
 */
@Module({
  providers: [
    DeliveryZoneRepository,
    DeliveryPricingRuleRepository,
    DeliveryZoneService,
    DeliveryPricingRuleService,
  ],
  exports: [
    DeliveryZoneRepository,
    DeliveryPricingRuleRepository,
    DeliveryZoneService,
    DeliveryPricingRuleService,
  ],
})
export class DeliveryPricingModule {}
