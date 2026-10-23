import { MONEY_CONTRACT_V1_MINOR, MONEY_CONTRACT_V2_DZD } from './money-contract';
import { projectMoneyPayload } from './money-response.projector';

describe('projectMoneyPayload', () => {
  const payload = {
    submittedAmountMinor: '65000',
    totalEarnedMinor: '15000',
    items: [{ amountMinor: '15000', currency: 'DZD' }],
  };

  it('leaves v1 payloads unchanged (*Minor remain centimes)', () => {
    expect(projectMoneyPayload(payload, MONEY_CONTRACT_V1_MINOR)).toEqual(
      payload,
    );
  });

  it('adds explicit DZD fields without rewriting *Minor', () => {
    const v2 = projectMoneyPayload(payload, MONEY_CONTRACT_V2_DZD) as {
      submittedAmountMinor: string;
      submittedAmount: string;
      totalEarned: string;
      items: Array<{ amountMinor: string; amount: string }>;
    };
    expect(v2.submittedAmountMinor).toBe('65000');
    expect(v2.submittedAmount).toBe('650.00');
    expect(v2.totalEarned).toBe('150.00');
    expect(v2.items[0].amountMinor).toBe('15000');
    expect(v2.items[0].amount).toBe('150.00');
  });

  it('does not invent money from unknown keys', () => {
    const v2 = projectMoneyPayload(
      { latitude: '36.75', count: 12 },
      MONEY_CONTRACT_V2_DZD,
    ) as Record<string, unknown>;
    expect(v2['latitude']).toBe('36.75');
    expect(v2['count']).toBe(12);
    expect(v2['amount']).toBeUndefined();
  });
});
