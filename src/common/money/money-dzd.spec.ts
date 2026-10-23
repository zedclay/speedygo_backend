import {
  assertMinorEqualsDzdTimes100,
  centimesFromDzdDecimalString,
  dzdDecimalStringFromCentimes,
  floorCommissionCentimes,
  isDzdDecimalString,
  moneyDzdToTransport,
  parseDzdDecimalString,
} from './money-dzd';

describe('money-dzd exact decimal', () => {
  it('650.00 DZD ↔ 65000 centimes', () => {
    expect(centimesFromDzdDecimalString('650.00')).toBe(65000n);
    expect(parseDzdInputAlias('650')).toBe(65000n);
    expect(dzdDecimalStringFromCentimes(65000n)).toBe('650.00');
    expect(moneyDzdToTransport(65000n)).toEqual({
      amount: '650.00',
      currency: 'DZD',
    });
  });

  it('rejects excess fractional precision (no silent round)', () => {
    expect(() => parseDzdDecimalString('650.505')).toThrow(/2 fractional/);
    expect(isDzdDecimalString('650.505')).toBe(false);
  });

  it('accepts one fractional digit by normalizing on serialize path only via centimes', () => {
    expect(centimesFromDzdDecimalString('10.5')).toBe(1050n);
    expect(dzdDecimalStringFromCentimes(1050n)).toBe('10.50');
  });

  it('reconciliation identity oldMinor = newDzd × 100', () => {
    assertMinorEqualsDzdTimes100(65000n, '650.00');
    assertMinorEqualsDzdTimes100(15000n, '150.00');
    expect(() => assertMinorEqualsDzdTimes100(65000n, '650.50')).toThrow(
      /Reconciliation failed/,
    );
  });

  it('commission floor matches minor-unit policy', () => {
    // 1000.00 DZD base, 7% = 700 bps → 70.00 DZD
    expect(floorCommissionCentimes(100000n, 700)).toBe(7000n);
    // remainder stays out of commission (floor)
    expect(floorCommissionCentimes(10001n, 700)).toBe(700n);
  });

  it('zero and signed paths', () => {
    expect(parseDzdDecimalString('0')).toBe(0n);
    expect(parseDzdDecimalString('0.00')).toBe(0n);
    expect(() => parseDzdDecimalString('-1.00')).toThrow(/Negative/);
    expect(parseDzdDecimalString('-1.00', { allowNegative: true })).toBe(-100n);
  });

  it('rejects null-like and ambiguous inputs', () => {
    expect(() => parseDzdDecimalString('')).toThrow();
    expect(() => parseDzdDecimalString(' 650.00')).toThrow();
    expect(() => parseDzdDecimalString('650.00 ')).toThrow();
    expect(() => parseDzdDecimalString(650 as unknown)).toThrow();
    expect(isDzdDecimalString(null)).toBe(false);
  });
});

/** Allow "650" as valid scale-0 decimal (pattern allows). */
function parseDzdInputAlias(raw: string): bigint {
  return parseDzdDecimalString(raw);
}
