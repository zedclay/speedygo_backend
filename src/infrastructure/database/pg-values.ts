/**
 * Prisma 8 brands varchar / timestamptz / inet inputs. Application strings are
 * cast at the persistence boundary after validation.
 */
import { persistStoredMoney } from '../../common/money/prisma-money-decimal';

export type PgVarchar<N extends number> = string & {
  readonly __varcharLength: N;
};
export type PgTimestamptz = string & {
  readonly __timestamptzStringPrecision: 6;
};

export function pgVarchar<N extends number>(value: string): PgVarchar<N> {
  return value as PgVarchar<N>;
}

export type PgChar<N extends number> = string & {
  readonly __charLength: N;
};

export function pgChar<N extends number>(value: string): PgChar<N> {
  return value as PgChar<N>;
}

export function pgTimestamptz(value: string): PgTimestamptz {
  return value as PgTimestamptz;
}

export function pgNow(): PgTimestamptz {
  return pgTimestamptz(new Date().toISOString());
}

export type PgTime = string & {
  readonly __timeString: true;
};

export function pgTime(value: string): PgTime {
  return value as PgTime;
}

export type PgNumeric<P extends number, S extends number> = string & {
  readonly __numericPrecision: P;
  readonly __numericScale: S;
};

export function pgNumeric<P extends number, S extends number>(
  value: number,
  scale: S,
): PgNumeric<P, S> {
  return value.toFixed(scale) as PgNumeric<P, S>;
}

/**
 * Persistence adapter for inventoried money columns.
 * BigInt centimes when MONEY_PRISMA_DECIMAL is unset (e2e / shared schema).
 * NUMERIC(19,2) DZD string when MONEY_PRISMA_DECIMAL=1 (rehearsal Decimal contract).
 * Non-money integers must not use this helper.
 */
export function pgBigInt(value: number | bigint | string): bigint {
  return persistStoredMoney(value);
}

export type PgDate = string & {
  readonly __dateString: true;
};

export function pgDate(value: string): PgDate {
  return value as PgDate;
}
