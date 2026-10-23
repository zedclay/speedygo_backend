import { calculateMerchantCommissionAmountMinor } from '../../modules/merchant-commissions/domain/merchant-commission.policy';
import { floorCommissionCentimes } from './money-dzd';

describe('ADR-001 floor commission matches current policy', () => {
  const cases: Array<[number, number]> = [
    [1200, 700],
    [1, 700],
    [3, 1],
    [9999, 1],
    [10000, 1],
    [100000, 700],
    [65000, 700],
  ];
  it.each(cases)('base=%i bps=%i', (base, bps) => {
    const current = calculateMerchantCommissionAmountMinor(base, bps);
    const adr = floorCommissionCentimes(BigInt(base), bps);
    expect(Number(adr)).toBe(current);
  });
});
