import {
  driverEarningAmountInvalid,
  driverEarningFinancialStateInvalid,
} from './driver-remuneration.errors';
import {
  DRIVER_EARNING_LIST_DEFAULT_LIMIT,
  DRIVER_EARNING_LIST_MAX_LIMIT,
  DRIVER_EARNING_STATUS_EARNED,
} from './driver-remuneration.types';

/**
 * Authoritative remuneration for v1.0 is OrderFinancialSnapshot.driverRemunerationMinor.
 * Matching offers copy the same snapshot field. This phase does not recalculate.
 *
 * v1.0 earning components:
 *   baseRemunerationMinor = snapshot.driverRemunerationMinor
 *   bonusMinor = 0
 *   adjustmentMinor = 0
 *   netEarningMinor = base + bonus + adjustment
 *   status = EARNED
 *
 * Zero base is valid (schema CHECK >= 0). Negative fails closed.
 */
export function requireDriverRemunerationMinor(amountMinor: number): number {
  if (
    !Number.isInteger(amountMinor) ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0
  ) {
    throw driverEarningAmountInvalid();
  }
  return amountMinor;
}

export function buildDriverEarningAmounts(baseRemunerationMinor: number): {
  baseRemunerationMinor: number;
  bonusMinor: number;
  adjustmentMinor: number;
  netEarningMinor: number;
  status: typeof DRIVER_EARNING_STATUS_EARNED;
} {
  const base = requireDriverRemunerationMinor(baseRemunerationMinor);
  const bonusMinor = 0;
  const adjustmentMinor = 0;
  const netEarningMinor = base + bonusMinor + adjustmentMinor;
  if (netEarningMinor < 0 || !Number.isSafeInteger(netEarningMinor)) {
    throw driverEarningFinancialStateInvalid(
      'Driver net earning would be invalid',
    );
  }
  return {
    baseRemunerationMinor: base,
    bonusMinor,
    adjustmentMinor,
    netEarningMinor,
    status: DRIVER_EARNING_STATUS_EARNED,
  };
}

export function normalizeDriverEarningListQuery(input: {
  limit?: number;
  offset?: number;
}): { limit: number; offset: number } {
  const limit = input.limit ?? DRIVER_EARNING_LIST_DEFAULT_LIMIT;
  const offset = input.offset ?? 0;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > DRIVER_EARNING_LIST_MAX_LIMIT
  ) {
    throw driverEarningFinancialStateInvalid(
      'Driver earning list limit is out of range',
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw driverEarningFinancialStateInvalid(
      'Driver earning list offset is out of range',
    );
  }
  return { limit, offset };
}

export function earningListEarnedAt(row: {
  validatedAt: string | null;
  createdAt: string;
}): string {
  return row.validatedAt ?? row.createdAt;
}
