/**
 * Exact DZD minor-unit transport helpers.
 * Persistence remains integer minor units (Prisma BigInt).
 * JSON transport for money is a base-10 decimal string — never JS Number.
 */

const MONEY_MINOR_STRING_PATTERN = /^-?[0-9]+$/;
const MONEY_MINOR_NONNEGATIVE_PATTERN = /^[0-9]+$/;

export const MONEY_MINOR_DECIMAL_STRING_PATTERN = '^-?[0-9]+$';
export const MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN = '^[0-9]+$';

/** Value used in precision tests: Number.MAX_SAFE_INTEGER + 2 */
export const MONEY_MINOR_ABOVE_SAFE_INTEGER = '9007199254740993';

/**
 * Serialize a DB/domain minor-unit amount as an exact base-10 decimal string.
 * Accepts bigint, integer number (safe range only), or an already-exact decimal string.
 * Does not use floating-point formatting (no exponent, no fractions).
 */
export function moneyMinorToDecimalString(
  value: bigint | number | string | null | undefined,
): string {
  if (value === null || value === undefined) {
    return '0';
  }
  if (typeof value === 'bigint') {
    return value.toString(10);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new TypeError(
        'moneyMinorToDecimalString requires a finite integer number',
      );
    }
    if (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) {
      throw new TypeError(
        'moneyMinorToDecimalString refused unsafe Number outside MAX_SAFE_INTEGER; pass bigint or decimal string',
      );
    }
    return value.toString(10);
  }
  const trimmed = value.trim();
  if (!MONEY_MINOR_STRING_PATTERN.test(trimmed)) {
    throw new TypeError(
      'moneyMinorToDecimalString requires an exact integer decimal string',
    );
  }
  return BigInt(trimmed).toString(10);
}

/**
 * Parse a client monetary input that may exceed JS safe integer range.
 * Rejects fractions, exponents, whitespace ambiguity, NaN, Infinity, and empty.
 * Returns bigint for exact arithmetic / persistence.
 */
export function parseMoneyMinorDecimalString(
  raw: unknown,
  options?: { allowNegative?: boolean },
): bigint {
  if (typeof raw === 'bigint') {
    if (!options?.allowNegative && raw < 0n) {
      throw new TypeError('Negative money is not allowed for this field');
    }
    return raw;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      throw new TypeError('Money input must be an integer');
    }
    if (raw > Number.MAX_SAFE_INTEGER || raw < Number.MIN_SAFE_INTEGER) {
      throw new TypeError(
        'Money number input exceeds JavaScript safe integer range; use a decimal string',
      );
    }
    if (!options?.allowNegative && raw < 0) {
      throw new TypeError('Negative money is not allowed for this field');
    }
    return BigInt(raw);
  }
  if (typeof raw !== 'string') {
    throw new TypeError('Money input must be a decimal string or integer');
  }
  if (raw.trim() !== raw) {
    throw new TypeError(
      'Money input must not include leading/trailing whitespace',
    );
  }
  const pattern = options?.allowNegative
    ? MONEY_MINOR_STRING_PATTERN
    : MONEY_MINOR_NONNEGATIVE_PATTERN;
  if (!pattern.test(raw)) {
    throw new TypeError(
      'Money input must be an exact base-10 integer decimal string',
    );
  }
  return BigInt(raw);
}

export function isMoneyMinorDecimalString(
  value: unknown,
  options?: { allowNegative?: boolean },
): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const pattern = options?.allowNegative
    ? MONEY_MINOR_STRING_PATTERN
    : MONEY_MINOR_NONNEGATIVE_PATTERN;
  return pattern.test(value);
}

/**
 * Sum monetary amounts exactly as bigint, then serialize for JSON transport.
 */
export function sumMoneyMinorToDecimalString(
  values: ReadonlyArray<bigint | number | string>,
): string {
  let total = 0n;
  for (const value of values) {
    if (typeof value === 'bigint') {
      total += value;
    } else if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(
          'sumMoneyMinorToDecimalString refused unsafe Number; pass bigint',
        );
      }
      total += BigInt(value);
    } else {
      total += BigInt(value);
    }
  }
  return total.toString(10);
}
