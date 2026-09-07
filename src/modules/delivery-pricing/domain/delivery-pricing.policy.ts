/**
 * Pricing rule domain policy for Admin Delivery Pricing v1.0.
 *
 * Rules (all pure JS, no DB round-trips):
 *  - customerDeliveryFeeMinor >= 0
 *  - driverRemunerationMinor >= 0
 *  - customerDeliveryFeeMinor >= driverRemunerationMinor
 *  - timeBand must be one of DAY | NIGHT | CUSTOM
 *  - startLocalTime and endLocalTime: both null or both present
 *  - effectiveTo > effectiveFrom (if effectiveTo is set)
 *  - Active-rule coexistence: multiple active rules per zone are allowed only when
 *    Checkout applicability predicates are provably disjoint (see pricing-applicability.policy)
 */

import { deliveryPricingRuleInvalid } from './delivery-pricing.errors';
import {
  DELIVERY_TIME_BANDS,
  type CreateDeliveryPricingRuleInput,
} from './delivery-pricing.types';

/**
 * Validate the create-rule input.
 * Called before any DB write so errors are returned before locking.
 */
export function validateCreatePricingRuleInput(
  input: CreateDeliveryPricingRuleInput,
): void {
  if (!DELIVERY_TIME_BANDS.includes(input.timeBand)) {
    throw deliveryPricingRuleInvalid(
      `timeBand must be one of ${DELIVERY_TIME_BANDS.join(', ')}`,
    );
  }

  const hasStart = input.startLocalTime !== null;
  const hasEnd = input.endLocalTime !== null;
  if (hasStart !== hasEnd) {
    throw deliveryPricingRuleInvalid(
      'startLocalTime and endLocalTime must both be set or both be null',
    );
  }

  if (input.customerDeliveryFeeMinor < 0n) {
    throw deliveryPricingRuleInvalid('customerDeliveryFeeMinor must be >= 0');
  }
  if (input.driverRemunerationMinor < 0n) {
    throw deliveryPricingRuleInvalid('driverRemunerationMinor must be >= 0');
  }
  if (input.customerDeliveryFeeMinor < input.driverRemunerationMinor) {
    throw deliveryPricingRuleInvalid(
      'customerDeliveryFeeMinor must be >= driverRemunerationMinor',
    );
  }

  const fromMs = Date.parse(input.effectiveFrom);
  if (!Number.isFinite(fromMs)) {
    throw deliveryPricingRuleInvalid(
      'effectiveFrom must be a valid ISO 8601 timestamp',
    );
  }
  if (input.effectiveTo !== null) {
    const toMs = Date.parse(input.effectiveTo);
    if (!Number.isFinite(toMs)) {
      throw deliveryPricingRuleInvalid(
        'effectiveTo must be a valid ISO 8601 timestamp',
      );
    }
    if (toMs <= fromMs) {
      throw deliveryPricingRuleInvalid(
        'effectiveTo must be strictly after effectiveFrom',
      );
    }
  }
}
