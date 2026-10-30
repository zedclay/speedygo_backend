/**
 * Promotion persistence boundary.
 *
 * Domain `value` is always a number:
 *   RATE_BPS  → integer basis points (0 < n ≤ 10000)
 *   FIXED     → integer centimes
 *
 * Decimal Prisma (MONEY_PRISMA_DECIMAL=1):
 *   RATE  → promotions.value INT bps, value_amount NULL
 *   FIXED → promotions.value NULL, value_amount NUMERIC(19,2) DZD
 *
 * Shared BigInt Prisma: both kinds write INT `value` only.
 */
import {
  isDecimalPrismaStorage,
  loadStoredCentimes,
  persistStoredMoney,
} from '../../../common/money/prisma-money-decimal';
import { dzdDecimalStringFromCentimes } from '../../../common/money/money-dzd';
import { parsePromotionType } from '../domain/promotion.policy';
import { PROMOTION_KIND_FIXED_MINOR } from '../domain/promotion.types';

export type PromotionMoneyRow = {
  type: string;
  value: number | null;
  valueAmount?: unknown;
};

export type PersistedPromotionMoney = {
  value: number | null;
  valueAmount?: unknown;
};

export function persistPromotionMoneyFields(
  type: string,
  domainValue: number,
): PersistedPromotionMoney {
  const parsed = parsePromotionType(type);
  if (!isDecimalPrismaStorage()) {
    return { value: domainValue };
  }
  if (parsed.kind === PROMOTION_KIND_FIXED_MINOR) {
    return {
      value: null,
      valueAmount: persistStoredMoney(domainValue),
    };
  }
  return { value: domainValue, valueAmount: null };
}

export function loadPromotionDomainValue(row: PromotionMoneyRow): number {
  const parsed = parsePromotionType(row.type);
  if (
    parsed.kind === PROMOTION_KIND_FIXED_MINOR &&
    row.valueAmount != null &&
    row.valueAmount !== ''
  ) {
    return Number(loadStoredCentimes(row.valueAmount));
  }
  if (row.value == null || row.value === undefined) {
    throw new TypeError(
      `Promotion ${parsed.kind} is missing persisted value`,
    );
  }
  return Number(row.value);
}

/** FIXED dzd-v2 twin. RATE_BPS returns null (bps are not DZD). */
export function promotionValueAmountDzd(
  type: string,
  domainValue: number,
): string | null {
  const parsed = parsePromotionType(type);
  if (parsed.kind !== PROMOTION_KIND_FIXED_MINOR) {
    return null;
  }
  return dzdDecimalStringFromCentimes(BigInt(domainValue));
}
