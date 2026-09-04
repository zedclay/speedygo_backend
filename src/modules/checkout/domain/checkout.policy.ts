import {
  checkoutPricingConfigurationInvalid,
  checkoutPricingRuleNotFound,
} from './checkout.errors';
import type { CheckoutPricingRuleRecord } from './checkout.types';

/** Pricing local time is evaluated in Africa/Algiers unless a future PlatformSetting overrides it. */
export const CHECKOUT_PRICING_TIMEZONE = 'Africa/Algiers';

export function localTimeOfDaySeconds(
  instant: Date,
  timeZone: string = CHECKOUT_PRICING_TIMEZONE,
): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(
    parts.find((part) => part.type === 'minute')?.value ?? '0',
  );
  const second = Number(
    parts.find((part) => part.type === 'second')?.value ?? '0',
  );
  return hour * 3600 + minute * 60 + second;
}

export function parseTimeOfDaySeconds(value: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? '0');
  if (
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second)
  ) {
    return null;
  }
  return hour * 3600 + minute * 60 + second;
}

/**
 * Inclusive window. When start > end the window wraps midnight.
 */
export function isTimeInWindow(
  nowSeconds: number,
  startSeconds: number,
  endSeconds: number,
): boolean {
  if (startSeconds === endSeconds) {
    return nowSeconds === startSeconds;
  }
  if (startSeconds < endSeconds) {
    return nowSeconds >= startSeconds && nowSeconds <= endSeconds;
  }
  return nowSeconds >= startSeconds || nowSeconds <= endSeconds;
}

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
  const startRaw = input.startLocalTime;
  const endRaw = input.endLocalTime;
  if (startRaw === null && endRaw === null) {
    return true;
  }
  if (startRaw === null || endRaw === null) {
    throw checkoutPricingConfigurationInvalid();
  }
  const start = parseTimeOfDaySeconds(startRaw);
  const end = parseTimeOfDaySeconds(endRaw);
  if (start === null || end === null) {
    throw checkoutPricingConfigurationInvalid();
  }
  return isTimeInWindow(input.nowSeconds, start, end);
}

export function isRuleEffectiveAt(
  rule: Pick<
    CheckoutPricingRuleRecord,
    'active' | 'effectiveFrom' | 'effectiveTo'
  >,
  instant: Date,
): boolean {
  if (!rule.active) {
    return false;
  }
  const from = Date.parse(rule.effectiveFrom);
  if (!Number.isFinite(from) || from > instant.getTime()) {
    return false;
  }
  if (!rule.effectiveTo) {
    return true;
  }
  const to = Date.parse(rule.effectiveTo);
  return Number.isFinite(to) && to > instant.getTime();
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
