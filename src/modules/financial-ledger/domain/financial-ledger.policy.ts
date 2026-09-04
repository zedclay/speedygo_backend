import { createHash } from 'node:crypto';
import {
  ledgerInvalidAmount,
  ledgerInvalidCurrency,
  ledgerInvalidSource,
} from './financial-ledger.errors';
import {
  LEDGER_CURRENCY_DZD,
  LEDGER_DIRECTION_CREDIT,
  LEDGER_DIRECTION_DEBIT,
  LEDGER_LIST_DEFAULT_LIMIT,
  LEDGER_LIST_MAX_LIMIT,
  LEDGER_SOURCE_COD_COLLECTION,
  LEDGER_SOURCE_COD_REMITTANCE,
  LEDGER_SOURCE_DRIVER_EARNING,
  LEDGER_SOURCE_MERCHANT_SETTLEMENT,
  LEDGER_SOURCE_PAYMENT,
  LEDGER_SOURCE_REFUND,
  LEDGER_TYPE_COD_CUSTODY,
  LEDGER_TYPE_CUSTOMER_PAYMENT,
  LEDGER_TYPE_DRIVER_PAYABLE,
  LEDGER_TYPE_MERCHANT_PAYABLE,
  LEDGER_TYPE_REFUND,
  type LedgerDirection,
  type LedgerSourceType,
} from './financial-ledger.types';

/** Advisory lock class: 'SGLD' — used with pg_advisory_xact_lock (transaction-scoped). */
export const FINANCIAL_LEDGER_LOCK_CLASS_ID = 0x53474c44;

export function ledgerAdvisoryObjectId(reference: string): number {
  const digest = createHash('sha256').update(reference).digest();
  const value = digest.readInt32BE(0);
  return value === 0 ? 1 : value;
}

/**
 * Canonical source identity encoded in FinancialLedgerEntry.reference.
 * Format: `{SOURCE_TYPE}:{SOURCE_UUID}` (≤128).
 * Same format MUST be used by same-TX posting, reconcileUnposted SQL, and audit lookup.
 */
export function buildLedgerReference(
  sourceType: LedgerSourceType,
  sourceId: string,
): string {
  if (!sourceId || sourceId.length < 8) {
    throw ledgerInvalidSource();
  }
  const reference = `${sourceType}:${sourceId}`;
  if (reference.length > 128) {
    throw ledgerInvalidSource('Ledger reference exceeds 128 characters');
  }
  return reference;
}

/** Prefix used by reconciler SQL (`PREFIX || id::text`) — must match buildLedgerReference. */
export function ledgerReferencePrefix(sourceType: LedgerSourceType): string {
  return `${sourceType}:`;
}

export function parseLedgerReference(
  reference: string,
): { sourceType: LedgerSourceType; sourceId: string } | null {
  const idx = reference.indexOf(':');
  if (idx <= 0) {
    return null;
  }
  const sourceType = reference.slice(0, idx);
  const sourceId = reference.slice(idx + 1);
  const allowed: string[] = [
    LEDGER_SOURCE_PAYMENT,
    LEDGER_SOURCE_COD_COLLECTION,
    LEDGER_SOURCE_COD_REMITTANCE,
    LEDGER_SOURCE_DRIVER_EARNING,
    LEDGER_SOURCE_REFUND,
    LEDGER_SOURCE_MERCHANT_SETTLEMENT,
  ];
  if (!allowed.includes(sourceType) || !sourceId) {
    return null;
  }
  return { sourceType: sourceType as LedgerSourceType, sourceId };
}

/** Reject client/arbitrary reference strings; only canonical `{SOURCE}:{uuid}` is allowed. */
export function requireCanonicalLedgerReference(reference: string): string {
  if (!parseLedgerReference(reference)) {
    throw ledgerInvalidSource(
      'Ledger reference must be a canonical source identity',
    );
  }
  return reference;
}

export function requireDzd(currency: string): void {
  if (currency !== LEDGER_CURRENCY_DZD) {
    throw ledgerInvalidCurrency();
  }
}

/** Nonnegative integer minor units (zero allowed for DriverEarning / Settlement audit postings). */
export function requireNonNegativeMinor(amountMinor: number): number {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw ledgerInvalidAmount();
  }
  return amountMinor;
}

export function requirePositiveMinor(amountMinor: number): number {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw ledgerInvalidAmount();
  }
  return amountMinor;
}

/**
 * Category-local direction semantics (NOT globally balanced double-entry):
 * - CUSTOMER_PAYMENT DEBIT = ELECTRONIC provider clearing (not bank cash)
 * - COD_CUSTODY DEBIT = custody ↑; CREDIT = remittance custody ↓
 * - DRIVER_PAYABLE CREDIT = SpeedyGo owes Driver
 * - MERCHANT_PAYABLE CREDIT = SpeedyGo owes Merchant; DEBIT = Merchant owes SpeedyGo
 * - REFUND DEBIT = Customer refund confirmed
 *
 * Never interpret SUM(all DEBIT) = SUM(all CREDIT) or a global platform cash balance.
 */
export function electronicPaymentPosting(amountMinor: number): {
  type: typeof LEDGER_TYPE_CUSTOMER_PAYMENT;
  direction: typeof LEDGER_DIRECTION_DEBIT;
  amountMinor: number;
} {
  return {
    type: LEDGER_TYPE_CUSTOMER_PAYMENT,
    direction: LEDGER_DIRECTION_DEBIT,
    amountMinor: requirePositiveMinor(amountMinor),
  };
}

export function codCollectionPosting(amountMinor: number): {
  type: typeof LEDGER_TYPE_COD_CUSTODY;
  direction: typeof LEDGER_DIRECTION_DEBIT;
  amountMinor: number;
} {
  return {
    type: LEDGER_TYPE_COD_CUSTODY,
    direction: LEDGER_DIRECTION_DEBIT,
    amountMinor: requirePositiveMinor(amountMinor),
  };
}

export function codRemittancePosting(amountMinor: number): {
  type: typeof LEDGER_TYPE_COD_CUSTODY;
  direction: typeof LEDGER_DIRECTION_CREDIT;
  amountMinor: number;
} {
  return {
    type: LEDGER_TYPE_COD_CUSTODY,
    direction: LEDGER_DIRECTION_CREDIT,
    amountMinor: requirePositiveMinor(amountMinor),
  };
}

export function driverEarningPosting(amountMinor: number): {
  type: typeof LEDGER_TYPE_DRIVER_PAYABLE;
  direction: typeof LEDGER_DIRECTION_CREDIT;
  amountMinor: number;
} {
  return {
    type: LEDGER_TYPE_DRIVER_PAYABLE,
    direction: LEDGER_DIRECTION_CREDIT,
    amountMinor: requireNonNegativeMinor(amountMinor),
  };
}

/**
 * Positive/zero net → CREDIT; negative net → DEBIT of abs(net).
 * Zero uses CREDIT 0 deterministically (audit + reconciler idempotency marker).
 */
export function merchantSettlementPosting(netPayableMinor: number): {
  type: typeof LEDGER_TYPE_MERCHANT_PAYABLE;
  direction: LedgerDirection;
  amountMinor: number;
} {
  if (!Number.isInteger(netPayableMinor)) {
    throw ledgerInvalidAmount('Settlement netPayableMinor must be an integer');
  }
  if (netPayableMinor >= 0) {
    return {
      type: LEDGER_TYPE_MERCHANT_PAYABLE,
      direction: LEDGER_DIRECTION_CREDIT,
      amountMinor: netPayableMinor,
    };
  }
  return {
    type: LEDGER_TYPE_MERCHANT_PAYABLE,
    direction: LEDGER_DIRECTION_DEBIT,
    amountMinor: Math.abs(netPayableMinor),
  };
}

export function refundPosting(amountMinor: number): {
  type: typeof LEDGER_TYPE_REFUND;
  direction: typeof LEDGER_DIRECTION_DEBIT;
  amountMinor: number;
} {
  return {
    type: LEDGER_TYPE_REFUND,
    direction: LEDGER_DIRECTION_DEBIT,
    amountMinor: requirePositiveMinor(amountMinor),
  };
}

/** Category-local: MERCHANT_PAYABLE credits − debits. Not a global ledger balance. */
export function deriveMerchantNetPayable(
  creditMinor: number,
  debitMinor: number,
): number {
  return creditMinor - debitMinor;
}

/** Category-local: DRIVER_PAYABLE credits − debits. */
export function deriveDriverPayable(
  creditMinor: number,
  debitMinor: number,
): number {
  return creditMinor - debitMinor;
}

/** Category-local: COD_CUSTODY debits − credits. Never net with DRIVER_PAYABLE. */
export function deriveCodCustody(
  debitMinor: number,
  creditMinor: number,
): number {
  return debitMinor - creditMinor;
}

export function normalizeLedgerListQuery(input: {
  limit?: number;
  offset?: number;
}): { limit: number; offset: number } {
  const limit =
    input.limit === undefined
      ? LEDGER_LIST_DEFAULT_LIMIT
      : Math.min(LEDGER_LIST_MAX_LIMIT, Math.max(1, Math.floor(input.limit)));
  const offset =
    input.offset === undefined ? 0 : Math.max(0, Math.floor(input.offset));
  return { limit, offset };
}

export type PlannedLedgerEntry = {
  type: string;
  direction: LedgerDirection;
  amountMinor: number;
  orderId: string | null;
  merchantId: string | null;
  driverId: string | null;
  reference: string;
};
