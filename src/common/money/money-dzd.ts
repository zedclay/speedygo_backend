/**
 * Exact DZD major-unit transport helpers (scale 2).
 * Authoritative arithmetic uses bigint centimes (0.01 DZD); JSON uses "650.00".
 * Never treat legacy amountMinor digit-strings as DZD majors.
 *
 * ADR: docs/migrations/money-dzd-decimal/ADR-001-money-dzd-decimal.md
 * Status: foundation for cutover — not yet wired as sole API truth.
 */

const DZD_DECIMAL_PATTERN = /^-?[0-9]+(\.[0-9]{1,2})?$/;
const DZD_NONNEG_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;

export const MONEY_DZD_CURRENCY = 'DZD' as const;
export const MONEY_DZD_DECIMAL_STRING_PATTERN = '^-?[0-9]+(\\.[0-9]{1,2})?$';
export const MONEY_DZD_NONNEGATIVE_DECIMAL_STRING_PATTERN =
  '^[0-9]+(\\.[0-9]{1,2})?$';

/** Catalog / payment max aligned with former CATALOG_PRICE_MINOR_MAX / 100. */
export const MONEY_DZD_MAX_MAJORS = '99999999.99';

export function centimesFromDzdDecimalString(raw: string): bigint {
  if (raw.trim() !== raw) {
    throw new TypeError('DZD input must not include leading/trailing whitespace');
  }
  if (!DZD_DECIMAL_PATTERN.test(raw)) {
    throw new TypeError(
      'DZD input must be an exact decimal string with at most 2 fractional digits',
    );
  }
  const negative = raw.startsWith('-');
  const body = negative ? raw.slice(1) : raw;
  const [wholePart, fracPart = ''] = body.split('.');
  if (fracPart.length > 2) {
    throw new TypeError('DZD input rejects more than 2 fractional digits');
  }
  const whole = BigInt(wholePart);
  const frac = BigInt(fracPart.padEnd(2, '0') || '0');
  const centimes = whole * 100n + frac;
  return negative ? -centimes : centimes;
}

export function parseDzdDecimalString(
  raw: unknown,
  options?: { allowNegative?: boolean },
): bigint {
  if (typeof raw === 'bigint') {
    if (!options?.allowNegative && raw < 0n) {
      throw new TypeError('Negative money is not allowed for this field');
    }
    return raw;
  }
  if (typeof raw !== 'string') {
    throw new TypeError('DZD money input must be a decimal string');
  }
  if (raw.trim() !== raw) {
    throw new TypeError('DZD input must not include leading/trailing whitespace');
  }
  if (!options?.allowNegative && raw.startsWith('-')) {
    throw new TypeError('Negative money is not allowed for this field');
  }
  // Reject excess precision before pattern match (no silent round).
  if (raw.includes('.')) {
    const frac = raw.split('.')[1] ?? '';
    if (frac.length > 2) {
      throw new TypeError('DZD input rejects more than 2 fractional digits');
    }
  }
  const pattern = options?.allowNegative
    ? DZD_DECIMAL_PATTERN
    : DZD_NONNEG_PATTERN;
  if (!pattern.test(raw)) {
    throw new TypeError(
      'DZD money input must be an exact scale-≤2 decimal string',
    );
  }
  const centimes = centimesFromDzdDecimalString(raw);
  if (!options?.allowNegative && centimes < 0n) {
    throw new TypeError('Negative money is not allowed for this field');
  }
  return centimes;
}

export function isDzdDecimalString(
  value: unknown,
  options?: { allowNegative?: boolean },
): value is string {
  if (typeof value !== 'string' || value.trim() !== value) {
    return false;
  }
  const pattern = options?.allowNegative
    ? DZD_DECIMAL_PATTERN
    : DZD_NONNEG_PATTERN;
  return pattern.test(value);
}

/** Serialize centimes bigint to canonical "650.00" (always 2 fractional digits). */
export function dzdDecimalStringFromCentimes(centimes: bigint): string {
  const neg = centimes < 0n;
  const abs = neg ? -centimes : centimes;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const body = `${whole.toString(10)}.${frac.toString(10).padStart(2, '0')}`;
  return neg ? `-${body}` : body;
}

export function moneyDzdToTransport(centimes: bigint): {
  amount: string;
  currency: typeof MONEY_DZD_CURRENCY;
} {
  return {
    amount: dzdDecimalStringFromCentimes(centimes),
    currency: MONEY_DZD_CURRENCY,
  };
}

/** Prove migration identity: oldMinor === newDzd × 100 (as bigint centimes). */
export function assertMinorEqualsDzdTimes100(
  oldMinor: bigint,
  newDzdDecimal: string,
): void {
  const fromDzd = centimesFromDzdDecimalString(newDzdDecimal);
  if (oldMinor !== fromDzd) {
    throw new Error(
      `Reconciliation failed: oldMinor=${oldMinor} newDzd=${newDzdDecimal} (centimes=${fromDzd})`,
    );
  }
}

/**
 * Commission / RATE_BPS: floor(baseCentimes * rateBps / 10000).
 * Same integer floor as today's minor-unit policy.
 */
export function floorCommissionCentimes(
  baseCentimes: bigint,
  rateBps: number,
): bigint {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new TypeError('rateBps must be an integer in 0..10000');
  }
  return (baseCentimes * BigInt(rateBps)) / 10000n;
}
