/**
 * Promotions Foundation v1.0 — safe subset on frozen Prisma.
 *
 * Models: Promotion + PromotionRedemption.
 * Funding on offer is encoded in application `type` (Promotion has no fundedBy column).
 * Scope/usage-limit columns are absent → GLOBAL code offers only; no maxUses.
 * SHARED funding is not implemented.
 */

export const PROMOTION_FUNDING_SPEEDYGO = 'SPEEDYGO';
export const PROMOTION_FUNDING_MERCHANT = 'MERCHANT';

export const PROMOTION_FUNDINGS_V1 = [
  PROMOTION_FUNDING_SPEEDYGO,
  PROMOTION_FUNDING_MERCHANT,
] as const;

export type PromotionFundingV1 = (typeof PROMOTION_FUNDINGS_V1)[number];

/** Discount math kinds (not stored alone — composed into Promotion.type). */
export const PROMOTION_KIND_RATE_BPS = 'RATE_BPS';
export const PROMOTION_KIND_FIXED_MINOR = 'FIXED_MINOR';

/**
 * Frozen application vocabulary for Promotion.type (VARCHAR(64)).
 * Encodes discount kind + funding because Prisma Promotion has no fundedBy.
 */
export const PROMOTION_TYPE_MERCHANT_RATE_BPS = 'MERCHANT_RATE_BPS';
export const PROMOTION_TYPE_SPEEDYGO_RATE_BPS = 'SPEEDYGO_RATE_BPS';
export const PROMOTION_TYPE_MERCHANT_FIXED_MINOR = 'MERCHANT_FIXED_MINOR';
export const PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR = 'SPEEDYGO_FIXED_MINOR';

export const PROMOTION_TYPES_V1 = [
  PROMOTION_TYPE_MERCHANT_RATE_BPS,
  PROMOTION_TYPE_SPEEDYGO_RATE_BPS,
  PROMOTION_TYPE_MERCHANT_FIXED_MINOR,
  PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
] as const;

export type PromotionTypeV1 = (typeof PROMOTION_TYPES_V1)[number];

export type PromotionRecord = {
  id: string;
  code: string;
  type: string;
  value: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PromotionDecision = {
  promotionId: string;
  code: string;
  type: PromotionTypeV1;
  funding: PromotionFundingV1;
  value: number;
  eligibleBaseMinor: number;
  discountAmountMinor: number;
  merchantDiscountMinor: number;
  platformDiscountMinor: number;
  decisionAt: string;
};

export type PromotionRedemptionRecord = {
  id: string;
  promotionId: string;
  customerId: string;
  orderId: string;
  discountAmountMinor: number;
  fundedBy: PromotionFundingV1;
  redeemedAt: string;
};

export type CreatePromotionInput = {
  code: string;
  type: string;
  value: number;
  startsAt: string;
  endsAt: string;
  active?: boolean;
};

export type EvaluatePromotionInput = {
  code: string;
  eligibleBaseMinor: number;
  decisionAt: Date;
};
