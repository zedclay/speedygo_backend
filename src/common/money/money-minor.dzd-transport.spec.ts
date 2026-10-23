import { moneyMinorToDecimalString } from './money-minor';

describe('legacy MONEY_JSON_UNIT flip retired', () => {
  it('*Minor serializer always emits centimes digits even if env set', () => {
    const prev = process.env.MONEY_JSON_UNIT;
    process.env.MONEY_JSON_UNIT = 'dzd';
    try {
      expect(moneyMinorToDecimalString(65000n)).toBe('65000');
      expect(moneyMinorToDecimalString(65000n)).not.toBe('650.00');
    } finally {
      if (prev === undefined) delete process.env.MONEY_JSON_UNIT;
      else process.env.MONEY_JSON_UNIT = prev;
    }
  });
});
