import {
  MONEY_CONTRACT_V1_MINOR,
  MONEY_CONTRACT_V2_DZD,
  parseDzdV2ToCentimes,
  parseMinorV1ToCentimes,
  parseMoneyWriteToCentimes,
  resolveMoneyContract,
} from './money-contract';

describe('money contracts — no unit guessing', () => {
  it('defaults to minor-v1', () => {
    expect(resolveMoneyContract({})).toBe(MONEY_CONTRACT_V1_MINOR);
  });

  it('selects dzd-v2 from Accept or header', () => {
    expect(
      resolveMoneyContract({
        accept: 'application/vnd.speedygo.money.v2+json',
      }),
    ).toBe(MONEY_CONTRACT_V2_DZD);
    expect(
      resolveMoneyContract({ 'x-speedygo-money-contract': 'dzd-v2' }),
    ).toBe(MONEY_CONTRACT_V2_DZD);
  });

  it('v1: "650" = 650 centimes; rejects "650.00"', () => {
    expect(parseMinorV1ToCentimes('650')).toBe(650n);
    expect(() => parseMinorV1ToCentimes('650.00')).toThrow(/integer/);
  });

  it('v2: "650" and "650.00" = 65000 centimes; rejects bare numbers', () => {
    expect(parseDzdV2ToCentimes('650')).toBe(65000n);
    expect(parseDzdV2ToCentimes('650.00')).toBe(65000n);
    expect(() => parseDzdV2ToCentimes(650)).toThrow(/decimal string/);
  });

  it('write parser dispatches by contract only', () => {
    expect(parseMoneyWriteToCentimes(MONEY_CONTRACT_V1_MINOR, '650')).toBe(
      650n,
    );
    expect(parseMoneyWriteToCentimes(MONEY_CONTRACT_V2_DZD, '650')).toBe(
      65000n,
    );
  });

  it('v1 and v2 encodings of 650.00 DZD are equivalent centimes', () => {
    expect(parseMinorV1ToCentimes('65000')).toBe(
      parseDzdV2ToCentimes('650.00'),
    );
    expect(parseMinorV1ToCentimes(65000)).toBe(parseDzdV2ToCentimes('650'));
  });
});
