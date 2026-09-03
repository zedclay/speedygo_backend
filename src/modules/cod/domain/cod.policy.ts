export const COD_COLLECTION_STATUS_COLLECTED = 'COLLECTED';

export const COD_REMITTANCE_STATUS_DECLARED = 'DECLARED';
export const COD_REMITTANCE_STATUS_CONFIRMED = 'CONFIRMED';

export const COD_DISCREPANCY_STATUS_OPEN = 'OPEN';

export const COD_CURRENCY_DZD = 'DZD';

/**
 * Derived collection reconciliation (not persisted on CodCollection.status).
 * CodCollection.status remains COLLECTED after Customer cash collection.
 */
export type DerivedCollectionReconciliation =
  'OUTSTANDING' | 'PARTIAL' | 'RECONCILED';

export function deriveCollectionReconciliation(
  collectedAmountMinor: number,
  confirmedAllocatedMinor: number,
): DerivedCollectionReconciliation {
  if (confirmedAllocatedMinor <= 0) {
    return 'OUTSTANDING';
  }
  if (confirmedAllocatedMinor >= collectedAmountMinor) {
    return 'RECONCILED';
  }
  return 'PARTIAL';
}

export function isExactCodAmount(input: {
  collectedAmountMinor: number;
  paymentAmountMinor: number;
  snapshotPayableMinor: number;
}): boolean {
  return (
    Number.isInteger(input.collectedAmountMinor) &&
    input.collectedAmountMinor >= 0 &&
    input.collectedAmountMinor === input.paymentAmountMinor &&
    input.paymentAmountMinor === input.snapshotPayableMinor
  );
}

export function isPositiveMinor(amount: number): boolean {
  return Number.isInteger(amount) && Number.isSafeInteger(amount) && amount > 0;
}
