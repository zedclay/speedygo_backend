import {
  buildNotificationCategory,
  copySettlementFinalized,
  normalizeNotificationListQuery,
  parseNotificationCategory,
  requireNotificationType,
  requireSourceId,
} from './notification.policy';
import {
  NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
  NOTIFICATION_TYPE_SETTLEMENT_FINALIZED,
} from './notification.types';

const SOURCE = '11111111-1111-7111-8111-111111111111';
const ACCOUNT = '22222222-2222-7222-8222-222222222222';

describe('notification.policy', () => {
  it('encodes and parses typed source category within 64 chars', () => {
    const category = buildNotificationCategory(
      NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
      SOURCE,
    );
    expect(category).toBe(`PAYMENT_SUCCEEDED:${SOURCE}`);
    expect(category.length).toBeLessThanOrEqual(64);
    expect(parseNotificationCategory(category)).toEqual({
      type: NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
      sourceId: SOURCE,
    });
  });

  it('rejects unknown notification types and non-UUID sources', () => {
    expect(() => requireNotificationType('MARKETING_BLAST')).toThrow();
    expect(() => requireSourceId('not-a-uuid')).toThrow();
  });

  it('bounds list pagination', () => {
    expect(normalizeNotificationListQuery({})).toEqual({
      limit: 20,
      offset: 0,
    });
    expect(() =>
      normalizeNotificationListQuery({ limit: 999, offset: -1 }),
    ).toThrow(/out of range/);
  });

  it('uses settlement wording without payout language', () => {
    const copy = copySettlementFinalized();
    expect(copy.title.toLowerCase()).not.toContain('paid');
    expect(copy.title.toLowerCase()).not.toContain('payout');
    expect(copy.body.toLowerCase()).toMatch(/settlement|statement/);
    void ACCOUNT;
    void NOTIFICATION_TYPE_SETTLEMENT_FINALIZED;
  });
});
