import {
  checkoutPricingConfigurationInvalid,
  checkoutPricingRuleNotFound,
} from './checkout.errors';
import type { CheckoutPricingRuleRecord } from './checkout.types';
import {
  CHECKOUT_PRICING_TIMEZONE,
  DELIVERY_PRICING_TIMEZONE,
  isRuleEffectiveAt,
  isTimeInWindow,
  localTimeOfDaySeconds,
  parseLocalWindow,
  parseTimeOfDaySeconds,
  pricingRulesApplicabilityConflict,
} from '../../delivery-pricing/domain/pricing-applicability.policy';

export {
  CHECKOUT_PRICING_TIMEZONE,
  DELIVERY_PRICING_TIMEZONE,
  isRuleEffectiveAt,
  isTimeInWindow,
  localTimeOfDaySeconds,
  parseTimeOfDaySeconds,
  pricingRulesApplicabilityConflict,
};

/**
 * v1.0 window rules:
 * - both times null → eligible for the entire Africa/Algiers local day
 * - both times present → inclusive window (wraps midnight when start > end)
 * - exactly one time present, or unparseable times → CHECKOUT_PRICING_CONFIGURATION_INVALID
 *
 * timeBand is metadata only. It does not imply hidden DAY/NIGHT hours.
 */
export function ruleAppliesAtLocalTime(input: {
  timeBand: string;
  startLocalTime: string | null;
  endLocalTime: string | null;
  nowSeconds: number;
}): boolean {
  void input.timeBand;
  const parsed = parseLocalWindow(input.startLocalTime, input.endLocalTime);
  if (parsed.kind === 'all_day') {
    return true;
  }
  if (parsed.kind === 'invalid') {
    throw checkoutPricingConfigurationInvalid();
  }
  return isTimeInWindow(
    input.nowSeconds,
    parsed.startSeconds,
    parsed.endSeconds,
  );
}

export function selectApplicablePricingRules(
  rules: CheckoutPricingRuleRecord[],
  instant: Date,
  timeZone: string = CHECKOUT_PRICING_TIMEZONE,
): CheckoutPricingRuleRecord[] {
  const nowSeconds = localTimeOfDaySeconds(instant, timeZone);
  const applicable: CheckoutPricingRuleRecord[] = [];
  for (const rule of rules) {
    if (!isRuleEffectiveAt(rule, instant)) {
      continue;
    }
    if (
      ruleAppliesAtLocalTime({
        timeBand: rule.timeBand,
        startLocalTime: rule.startLocalTime,
        endLocalTime: rule.endLocalTime,
        nowSeconds,
      })
    ) {
      applicable.push(rule);
    }
  }
  return applicable;
}

export function requireSinglePricingRule(
  rules: CheckoutPricingRuleRecord[],
): CheckoutPricingRuleRecord {
  if (rules.length === 0) {
    throw checkoutPricingRuleNotFound();
  }
  if (rules.length > 1) {
    throw checkoutPricingConfigurationInvalid();
  }
  return rules[0];
}

export function customerTotalMinor(
  merchandiseSubtotalMinor: number,
  deliveryFeeMinor: number,
  discountMinor = 0,
): number {
  if (
    !Number.isInteger(merchandiseSubtotalMinor) ||
    !Number.isInteger(deliveryFeeMinor) ||
    !Number.isInteger(discountMinor) ||
    merchandiseSubtotalMinor < 0 ||
    deliveryFeeMinor < 0 ||
    discountMinor < 0
  ) {
    throw checkoutPricingConfigurationInvalid();
  }
  if (discountMinor > merchandiseSubtotalMinor) {
    throw checkoutPricingConfigurationInvalid();
  }
  const total = merchandiseSubtotalMinor - discountMinor + deliveryFeeMinor;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw checkoutPricingConfigurationInvalid();
  }
  return total;
}
