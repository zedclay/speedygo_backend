import {
  promotionCodeInvalid,
  promotionConfigurationInvalid,
  promotionExpired,
  promotionInactive,
  promotionNotYetActive,
  promotionZeroPayableUnsupported,
} from './promotion.errors';
import {
  PROMOTION_FUNDING_MERCHANT,
  PROMOTION_FUNDING_SPEEDYGO,
  PROMOTION_KIND_FIXED_MINOR,
  PROMOTION_KIND_RATE_BPS,
  PROMOTION_TYPE_MERCHANT_FIXED_MINOR,
  PROMOTION_TYPE_MERCHANT_RATE_BPS,
  PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
  PROMOTION_TYPE_SPEEDYGO_RATE_BPS,
  PROMOTION_TYPES_V1,
  type PromotionDecision,
  type PromotionFundingV1,
  type PromotionRecord,
  type PromotionTypeV1,
} from './promotion.types';

const CODE_MAX_LEN = 64;

/**
 * Canonical code normalization: trim + uppercase ASCII letters.
 * Lookup uses the normalized form; codes are stored normalized.
 */
export function normalizePromotionCode(raw: string): string {
  if (typeof raw !== 'string') {
    throw promotionCodeInvalid();
  }
  const normalized = raw.trim().toUpperCase();
  if (!normalized || normalized.length > CODE_MAX_LEN) {
    throw promotionCodeInvalid();
  }
  if (!/^[A-Z0-9_-]+$/.test(normalized)) {
    throw promotionCodeInvalid();
  }
  return normalized;
}

export function parsePromotionType(type: string): {
  type: PromotionTypeV1;
  kind: typeof PROMOTION_KIND_RATE_BPS | typeof PROMOTION_KIND_FIXED_MINOR;
  funding: PromotionFundingV1;
} {
  if (!(PROMOTION_TYPES_V1 as readonly string[]).includes(type)) {
    throw promotionConfigurationInvalid(`Unsupported promotion type: ${type}`);
  }
  const typed = type as PromotionTypeV1;
  switch (typed) {
    case PROMOTION_TYPE_MERCHANT_RATE_BPS:
      return {
        type: typed,
        kind: PROMOTION_KIND_RATE_BPS,
        funding: PROMOTION_FUNDING_MERCHANT,
      };
    case PROMOTION_TYPE_SPEEDYGO_RATE_BPS:
      return {
        type: typed,
        kind: PROMOTION_KIND_RATE_BPS,
        funding: PROMOTION_FUNDING_SPEEDYGO,
      };
    case PROMOTION_TYPE_MERCHANT_FIXED_MINOR:
      return {
        type: typed,
        kind: PROMOTION_KIND_FIXED_MINOR,
        funding: PROMOTION_FUNDING_MERCHANT,
      };
    case PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR:
      return {
        type: typed,
        kind: PROMOTION_KIND_FIXED_MINOR,
        funding: PROMOTION_FUNDING_SPEEDYGO,
      };
    default:
      throw promotionConfigurationInvalid(
        `Unsupported promotion type: ${String(typed)}`,
      );
  }
}

export function requirePromotionValue(
  kind: typeof PROMOTION_KIND_RATE_BPS | typeof PROMOTION_KIND_FIXED_MINOR,
  value: number,
): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw promotionConfigurationInvalid(
      'Promotion value must be a positive integer',
    );
  }
  if (kind === PROMOTION_KIND_RATE_BPS && value > 10000) {
    throw promotionConfigurationInvalid('Promotion rateBps must be <= 10000');
  }
  return value;
}

/**
 * Effective window: active && startsAt <= decisionAt < endsAt (half-open).
 */
export function assertPromotionEffective(
  promotion: Pick<PromotionRecord, 'active' | 'startsAt' | 'endsAt'>,
  decisionAt: Date,
): void {
  if (!promotion.active) {
    throw promotionInactive();
  }
  const start = new Date(promotion.startsAt).getTime();
  const end = new Date(promotion.endsAt).getTime();
  const at = decisionAt.getTime();
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(at)
  ) {
    throw promotionConfigurationInvalid(
      'Promotion window timestamps are invalid',
    );
  }
  if (at < start) {
    throw promotionNotYetActive();
  }
  if (at >= end) {
    throw promotionExpired();
  }
}

/**
 * Percentage: floor(eligibleBaseMinor * rateBps / 10000) using BigInt.
 * Fixed: configured minor units.
 * Cap: never exceed eligible merchandise base.
 */
export function calculateDiscountAmountMinor(input: {
  kind: typeof PROMOTION_KIND_RATE_BPS | typeof PROMOTION_KIND_FIXED_MINOR;
  value: number;
  eligibleBaseMinor: number;
}): number {
  if (
    !Number.isInteger(input.eligibleBaseMinor) ||
    input.eligibleBaseMinor < 0
  ) {
    throw promotionConfigurationInvalid(
      'Eligible base must be a non-negative integer',
    );
  }
  requirePromotionValue(input.kind, input.value);
  let raw: number;
  if (input.kind === PROMOTION_KIND_RATE_BPS) {
    raw = Number(
      (BigInt(input.eligibleBaseMinor) * BigInt(input.value)) / 10000n,
    );
  } else {
    raw = input.value;
  }
  if (!Number.isInteger(raw) || raw < 0) {
    throw promotionConfigurationInvalid('Discount calculation failed');
  }
  return Math.min(raw, input.eligibleBaseMinor);
}

export function allocateDiscountByFunding(
  discountAmountMinor: number,
  funding: PromotionFundingV1,
): { merchantDiscountMinor: number; platformDiscountMinor: number } {
  if (!Number.isInteger(discountAmountMinor) || discountAmountMinor < 0) {
    throw promotionConfigurationInvalid('Discount amount is invalid');
  }
  if (funding === PROMOTION_FUNDING_MERCHANT) {
    return {
      merchantDiscountMinor: discountAmountMinor,
      platformDiscountMinor: 0,
    };
  }
  return {
    merchantDiscountMinor: 0,
    platformDiscountMinor: discountAmountMinor,
  };
}

export function buildPromotionDecision(input: {
  promotion: PromotionRecord;
  eligibleBaseMinor: number;
  decisionAt: Date;
}): PromotionDecision {
  assertPromotionEffective(input.promotion, input.decisionAt);
  const parsed = parsePromotionType(input.promotion.type);
  const discountAmountMinor = calculateDiscountAmountMinor({
    kind: parsed.kind,
    value: input.promotion.value,
    eligibleBaseMinor: input.eligibleBaseMinor,
  });
  const buckets = allocateDiscountByFunding(
    discountAmountMinor,
    parsed.funding,
  );
  return {
    promotionId: input.promotion.id,
    code: input.promotion.code,
    type: parsed.type,
    funding: parsed.funding,
    value: input.promotion.value,
    eligibleBaseMinor: input.eligibleBaseMinor,
    discountAmountMinor,
    merchantDiscountMinor: buckets.merchantDiscountMinor,
    platformDiscountMinor: buckets.platformDiscountMinor,
    decisionAt: input.decisionAt.toISOString(),
  };
}

export function requireCreatePromotionWindow(
  startsAt: string,
  endsAt: string,
): void {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
    throw promotionConfigurationInvalid(
      'Promotion endsAt must be strictly after startsAt',
    );
  }
}

/**
 * Final Customer payable after a merchandise Promotion must stay strictly positive.
 * Full merchandise discount is allowed when deliveryFee (and serviceFee) keep payable > 0.
 * Zero payable is unsupported — no fake Payment SUCCEEDED / zero Chargily / COD bypass.
 */
export function requirePositiveCustomerPayableAfterPromotion(input: {
  merchandiseSubtotalMinor: number;
  discountAmountMinor: number;
  deliveryFeeMinor: number;
  serviceFeeMinor?: number;
}): number {
  const serviceFeeMinor = input.serviceFeeMinor ?? 0;
  if (
    !Number.isInteger(input.merchandiseSubtotalMinor) ||
    !Number.isInteger(input.discountAmountMinor) ||
    !Number.isInteger(input.deliveryFeeMinor) ||
    !Number.isInteger(serviceFeeMinor) ||
    input.merchandiseSubtotalMinor < 0 ||
    input.discountAmountMinor < 0 ||
    input.deliveryFeeMinor < 0 ||
    serviceFeeMinor < 0
  ) {
    throw promotionConfigurationInvalid(
      'Promotion payable inputs must be non-negative integers',
    );
  }
  if (input.discountAmountMinor > input.merchandiseSubtotalMinor) {
    throw promotionConfigurationInvalid(
      'Promotion discount cannot exceed merchandise subtotal',
    );
  }
  const afterMerchandise =
    input.merchandiseSubtotalMinor - input.discountAmountMinor;
  const customerPayableMinor =
    afterMerchandise + input.deliveryFeeMinor + serviceFeeMinor;
  if (
    !Number.isSafeInteger(customerPayableMinor) ||
    customerPayableMinor <= 0
  ) {
    throw promotionZeroPayableUnsupported();
  }
  return customerPayableMinor;
}
