/**
 * Prisma Decimal persistence adapter.
 * When MONEY_PRISMA_DECIMAL=1, stored values are NUMERIC(19,2) DZD majors.
 * Domain/policy still uses bigint centimes. HTTP *Minor stays centimes.
 */
import {
  centimesFromDzdDecimalString,
  dzdDecimalStringFromCentimes,
} from './money-dzd';

export function isDecimalPrismaStorage(): boolean {
  return process.env['MONEY_PRISMA_DECIMAL'] === '1';
}

/** Accept Prisma Decimal-like ({ toFixed }) or string/number. */
export function centimesFromPrismaDecimal(
  value: { toFixed: (digits: number) => string } | string | null | undefined,
): bigint {
  if (value === null || value === undefined) {
    return 0n;
  }
  const s = typeof value === 'string' ? value : value.toFixed(2);
  return centimesFromDzdDecimalString(s);
}

export function dzdStringFromCentimes(centimes: bigint): string {
  return dzdDecimalStringFromCentimes(centimes);
}

/**
 * Load a Prisma money cell into bigint centimes.
 * Decimal runtime: NUMERIC "650.00" → 65000n.
 * Legacy BigInt runtime: 65000n / "65000" → 65000n.
 */
export function loadStoredCentimes(value: unknown): bigint {
  if (value === null || value === undefined) {
    return 0n;
  }
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new TypeError('Stored money number must be a safe integer');
    }
    return BigInt(value);
  }
  if (typeof value === 'object' && value && 'toFixed' in value) {
    return centimesFromPrismaDecimal(
      value as { toFixed: (digits: number) => string },
    );
  }
  if (typeof value !== 'string') {
    throw new TypeError('Stored money must be bigint, integer, or decimal string');
  }
  if (isDecimalPrismaStorage()) {
    // NUMERIC cells are scale-2 ("450.00"). Integer digit strings are
    // in-process centimes already serialized by moneyMinorToDecimalString.
    if (value.includes('.')) {
      return centimesFromDzdDecimalString(value);
    }
    if (!/^-?[0-9]+$/.test(value)) {
      throw new TypeError('Decimal-mode money string must be NUMERIC or centimes digits');
    }
    return BigInt(value);
  }
  if (!/^-?[0-9]+$/.test(value)) {
    throw new TypeError('Legacy stored money must be integer digit string');
  }
  return BigInt(value);
}

/** Persist centimes as Prisma BigInt or NUMERIC(19,2) string. */
export function persistStoredMoney(centimes: number | bigint | string): bigint {
  const n =
    typeof centimes === 'bigint'
      ? centimes
      : typeof centimes === 'number'
        ? BigInt(centimes)
        : BigInt(centimes);
  if (isDecimalPrismaStorage()) {
    return dzdDecimalStringFromCentimes(n) as unknown as bigint;
  }
  return n;
}

export function assertCentimesMatchDecimal(
  centimes: bigint,
  decimal: { toFixed: (digits: number) => string } | string,
): void {
  const fromDec = centimesFromPrismaDecimal(decimal);
  if (fromDec !== centimes) {
    throw new Error(
      `Decimal/centimes mismatch: centimes=${centimes} decimal=${String(decimal)}`,
    );
  }
}
