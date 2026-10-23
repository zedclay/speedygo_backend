import {
  deriveAdminCodDriverReconciliationStatus,
  deriveCollectionReconciliation,
  isExactCodAmount,
  isPositiveMinor,
} from './cod.policy';

describe('cod.policy', () => {
  it('requires exact COD amount equality across collected/payment/snapshot', () => {
    expect(
      isExactCodAmount({
        collectedAmountMinor: 1200,
        paymentAmountMinor: 1200,
        snapshotPayableMinor: 1200,
      }),
    ).toBe(true);
    expect(
      isExactCodAmount({
        collectedAmountMinor: 1100,
        paymentAmountMinor: 1200,
        snapshotPayableMinor: 1200,
      }),
    ).toBe(false);
    expect(
      isExactCodAmount({
        collectedAmountMinor: 1200,
        paymentAmountMinor: 1200,
        snapshotPayableMinor: 1300,
      }),
    ).toBe(false);
  });

  it('requires positive remittance amounts', () => {
    expect(isPositiveMinor(1)).toBe(true);
    expect(isPositiveMinor(0)).toBe(false);
    expect(isPositiveMinor(-1)).toBe(false);
    expect(isPositiveMinor(1.5)).toBe(false);
  });

  it('derives collection reconciliation from allocation totals', () => {
    expect(deriveCollectionReconciliation(4000, 0)).toBe('OUTSTANDING');
    expect(deriveCollectionReconciliation(4000, 2000)).toBe('PARTIAL');
    expect(deriveCollectionReconciliation(4000, 4000)).toBe('RECONCILED');
  });

  it('overlays remittance discrepancy on admin driver status', () => {
    expect(
      deriveAdminCodDriverReconciliationStatus({
        collectedAmountMinor: 4000,
        confirmedAllocatedMinor: 4000,
        discrepancyRemittanceCount: 1,
      }),
    ).toBe('DISCREPANCY');
    expect(
      deriveAdminCodDriverReconciliationStatus({
        collectedAmountMinor: 4000,
        confirmedAllocatedMinor: 0,
        discrepancyRemittanceCount: 0,
      }),
    ).toBe('OUTSTANDING');
  });
});
