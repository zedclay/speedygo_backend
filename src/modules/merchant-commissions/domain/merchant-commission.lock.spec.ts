import {
  MERCHANT_COMMISSION_ADVISORY_LOCK_CLASS,
  merchantCommissionAdvisoryLockKeys,
} from './merchant-commission.lock';

describe('merchant-commission.lock', () => {
  it('uses a fixed class and objectId 0 for GLOBAL_DEFAULT', () => {
    const keys = merchantCommissionAdvisoryLockKeys('GLOBAL_DEFAULT', null);
    expect(keys.classId).toBe(MERCHANT_COMMISSION_ADVISORY_LOCK_CLASS);
    expect(keys.objectId).toBe(0);
  });

  it('derives a stable non-zero per-Merchant override key', () => {
    const merchantA = '11111111-1111-7111-8111-111111111111';
    const merchantB = '22222222-2222-7222-8222-222222222222';
    const a1 = merchantCommissionAdvisoryLockKeys(
      'MERCHANT_OVERRIDE',
      merchantA,
    );
    const a2 = merchantCommissionAdvisoryLockKeys(
      'MERCHANT_OVERRIDE',
      merchantA,
    );
    const b = merchantCommissionAdvisoryLockKeys(
      'MERCHANT_OVERRIDE',
      merchantB,
    );
    expect(a1).toEqual(a2);
    expect(a1.objectId).not.toBe(0);
    expect(a1.objectId).not.toBe(b.objectId);
    expect(a1.classId).toBe(MERCHANT_COMMISSION_ADVISORY_LOCK_CLASS);
  });
});
