import { Injectable } from '@nestjs/common';
import { type SpeedyGoDb } from '../../../infrastructure/database/database.module';
import { validateCreatePricingRuleInput } from '../domain/delivery-pricing.policy';
import { pricingRulesApplicabilityConflict } from '../domain/pricing-applicability.policy';
import {
  deliveryPricingRuleConflict,
  deliveryPricingRuleNotFound,
} from '../domain/delivery-pricing.errors';
import type {
  CreateDeliveryPricingRuleInput,
  DeliveryPricingRuleRecord,
} from '../domain/delivery-pricing.types';
import { DeliveryPricingRuleRepository } from '../infrastructure/delivery-pricing-rule.repository';
import { DeliveryZoneRepository } from '../infrastructure/delivery-zone.repository';

/** Minimal client shape compatible with the transaction callback context. */
type TxClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

export type RuleMutationResult = {
  rule: DeliveryPricingRuleRecord;
  mutated: boolean;
};

@Injectable()
export class DeliveryPricingRuleService {
  constructor(
    private readonly rules: DeliveryPricingRuleRepository,
    private readonly zones: DeliveryZoneRepository,
  ) {}

  async createRuleInTx(
    tx: TxClient,
    input: CreateDeliveryPricingRuleInput,
  ): Promise<DeliveryPricingRuleRecord> {
    validateCreatePricingRuleInput(input);
    await this.zones.requireById(input.zoneId, tx);
    // Create is always inactive — still take the per-zone lock so a concurrent
    // activate cannot interleave oddly with create+immediate activate races.
    await this.rules.lockPricingAuthorityForZone(input.zoneId, tx);
    return this.rules.create(input, tx);
  }

  async activateRuleInTx(
    tx: TxClient,
    ruleId: string,
  ): Promise<RuleMutationResult> {
    const rule = await this.rules.findByIdForUpdate(ruleId, tx);
    if (!rule) {
      throw deliveryPricingRuleNotFound();
    }
    await this.rules.lockPricingAuthorityForZone(rule.zoneId, tx);
    if (rule.active) {
      return { rule, mutated: false };
    }
    await this.rules.lockActiveRulesForZone(rule.zoneId, tx);
    const activeRules = await this.rules.listActiveRulesForZone(
      rule.zoneId,
      tx,
    );
    for (const other of activeRules) {
      if (other.id === rule.id) continue;
      if (pricingRulesApplicabilityConflict(rule, other)) {
        throw deliveryPricingRuleConflict(
          `Activation conflicts with active rule ${other.id}: applicability windows are not disjoint.`,
        );
      }
    }
    const updated = await this.rules.setActive(ruleId, true, tx);
    return { rule: updated, mutated: true };
  }

  async deactivateRuleInTx(
    tx: TxClient,
    ruleId: string,
  ): Promise<RuleMutationResult> {
    const rule = await this.rules.findByIdForUpdate(ruleId, tx);
    if (!rule) {
      throw deliveryPricingRuleNotFound();
    }
    await this.rules.lockPricingAuthorityForZone(rule.zoneId, tx);
    if (!rule.active) {
      return { rule, mutated: false };
    }
    const updated = await this.rules.setActive(ruleId, false, tx);
    return { rule: updated, mutated: true };
  }
}
