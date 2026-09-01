/**
 * Prisma 8 brands varchar / timestamptz / inet inputs. Application strings are
 * cast at the persistence boundary after validation.
 */

export type PgVarchar<N extends number> = string & {
  readonly __varcharLength: N;
};
export type PgTimestamptz = string & {
  readonly __timestamptzStringPrecision: 6;
};

export function pgVarchar<N extends number>(value: string): PgVarchar<N> {
  return value as PgVarchar<N>;
}

export function pgTimestamptz(value: string): PgTimestamptz {
  return value as PgTimestamptz;
}

export function pgNow(): PgTimestamptz {
  return pgTimestamptz(new Date().toISOString());
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

export function pgBigInt(value: number): bigint {
  return BigInt(value);
}
