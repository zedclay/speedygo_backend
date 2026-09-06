import {
  MONEY_MINOR_ABOVE_SAFE_INTEGER,
  moneyMinorToDecimalString,
  parseMoneyMinorDecimalString,
  sumMoneyMinorToDecimalString,
} from './money-minor';

describe('moneyMinorToDecimalString', () => {
  it('serializes zero', () => {
    expect(moneyMinorToDecimalString(0)).toBe('0');
    expect(moneyMinorToDecimalString(0n)).toBe('0');
    expect(moneyMinorToDecimalString('0')).toBe('0');
    expect(moneyMinorToDecimalString(null)).toBe('0');
    expect(moneyMinorToDecimalString(undefined)).toBe('0');
  });

  it('serializes normal positive values', () => {
    expect(moneyMinorToDecimalString(1500)).toBe('1500');
    expect(moneyMinorToDecimalString(1500n)).toBe('1500');
    expect(moneyMinorToDecimalString('1500')).toBe('1500');
  });

  it('serializes domain-allowed negatives', () => {
    expect(moneyMinorToDecimalString(-500)).toBe('-500');
    expect(moneyMinorToDecimalString(-500n)).toBe('-500');
    expect(moneyMinorToDecimalString('-500')).toBe('-500');
  });

  it('preserves Number.MAX_SAFE_INTEGER exactly', () => {
    expect(moneyMinorToDecimalString(Number.MAX_SAFE_INTEGER)).toBe(
      '9007199254740991',
    );
    expect(moneyMinorToDecimalString(9007199254740991n)).toBe(
      '9007199254740991',
    );
  });

  it('preserves values above Number.MAX_SAFE_INTEGER from bigint/string', () => {
    expect(moneyMinorToDecimalString(9007199254740993n)).toBe(
      MONEY_MINOR_ABOVE_SAFE_INTEGER,
    );
    expect(moneyMinorToDecimalString(MONEY_MINOR_ABOVE_SAFE_INTEGER)).toBe(
      MONEY_MINOR_ABOVE_SAFE_INTEGER,
    );
  });

  it('refuses unsafe Number outside MAX_SAFE_INTEGER', () => {
    // Construct without going through Number() on the literal itself in the assertion path.
    const unsafe = Number(MONEY_MINOR_ABOVE_SAFE_INTEGER);
    expect(() => moneyMinorToDecimalString(unsafe)).toThrow(/MAX_SAFE_INTEGER/);
  });

  it('never emits exponent notation', () => {
    const serialized = moneyMinorToDecimalString(9007199254740993n);
    expect(serialized).not.toMatch(/[eE]/);
    expect(serialized).toBe(MONEY_MINOR_ABOVE_SAFE_INTEGER);
  });

  it('normalizes leading zeros via bigint', () => {
    expect(moneyMinorToDecimalString('0001500')).toBe('1500');
    expect(moneyMinorToDecimalString('-0007')).toBe('-7');
  });

  it('rejects fractions and non-integer strings', () => {
    expect(() => moneyMinorToDecimalString('1.5')).toThrow();
    expect(() => moneyMinorToDecimalString('1e3')).toThrow();
    expect(() => moneyMinorToDecimalString(1.5)).toThrow();
  });
});

describe('parseMoneyMinorDecimalString', () => {
  it('parses exact decimal strings including above safe integer', () => {
    expect(parseMoneyMinorDecimalString(MONEY_MINOR_ABOVE_SAFE_INTEGER)).toBe(
      9007199254740993n,
    );
  });

  it('rejects fractions, exponents, whitespace, and negatives by default', () => {
    expect(() => parseMoneyMinorDecimalString('1.0')).toThrow();
    expect(() => parseMoneyMinorDecimalString('1e2')).toThrow();
    expect(() => parseMoneyMinorDecimalString(' 1')).toThrow();
    expect(() => parseMoneyMinorDecimalString('-1')).toThrow();
    expect(() => parseMoneyMinorDecimalString(Number.NaN)).toThrow();
    expect(() =>
      parseMoneyMinorDecimalString(Number.POSITIVE_INFINITY),
    ).toThrow();
  });

  it('allows negatives when opted in', () => {
    expect(parseMoneyMinorDecimalString('-500', { allowNegative: true })).toBe(
      -500n,
    );
  });

  it('refuses unsafe Number inputs outside MAX_SAFE_INTEGER', () => {
    const unsafe = Number(MONEY_MINOR_ABOVE_SAFE_INTEGER);
    expect(() => parseMoneyMinorDecimalString(unsafe)).toThrow(
      /safe integer range/,
    );
  });
});

describe('sumMoneyMinorToDecimalString', () => {
  it('sums bigint amounts exactly above safe integer', () => {
    expect(sumMoneyMinorToDecimalString([9007199254740991n, 2n])).toBe(
      MONEY_MINOR_ABOVE_SAFE_INTEGER,
    );
  });
});
