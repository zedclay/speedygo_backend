/**
 * Financial Ledger Foundation v1.0 — OPERATIONAL SIGNED-EVENT SUBLEDGER.
 *
 * DEBIT/CREDIT are category-local operational directions with amountMinor >= 0.
 * There is NO globally balanced double-entry invariant and NO valid
 * platformBalance = allDebits − allCredits formula.
 *
 * Revenue types (MERCHANT_COMMISSION / DELIVERY_REVENUE / SERVICE_FEE) are deferred.
 */

export const LEDGER_CURRENCY_DZD = 'DZD';

export const LEDGER_DIRECTION_DEBIT = 'DEBIT';
export const LEDGER_DIRECTION_CREDIT = 'CREDIT';

export const LEDGER_DIRECTIONS = [
  LEDGER_DIRECTION_DEBIT,
  LEDGER_DIRECTION_CREDIT,
] as const;

export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

/** Application-frozen type vocabulary (schema type is free VARCHAR). */
export const LEDGER_TYPE_CUSTOMER_PAYMENT = 'CUSTOMER_PAYMENT';
export const LEDGER_TYPE_COD_CUSTODY = 'COD_CUSTODY';
export const LEDGER_TYPE_DRIVER_PAYABLE = 'DRIVER_PAYABLE';
export const LEDGER_TYPE_MERCHANT_PAYABLE = 'MERCHANT_PAYABLE';
export const LEDGER_TYPE_REFUND = 'REFUND';
export const LEDGER_TYPE_REVERSAL = 'REVERSAL';

/** v1.0 system-posted types (REVERSAL reserved; not auto-created). */
export const LEDGER_TYPES_V1 = [
  LEDGER_TYPE_CUSTOMER_PAYMENT,
  LEDGER_TYPE_COD_CUSTODY,
  LEDGER_TYPE_DRIVER_PAYABLE,
  LEDGER_TYPE_MERCHANT_PAYABLE,
  LEDGER_TYPE_REFUND,
] as const;

export type LedgerTypeV1 = (typeof LEDGER_TYPES_V1)[number];

export const LEDGER_SOURCE_PAYMENT = 'PAYMENT';
export const LEDGER_SOURCE_COD_COLLECTION = 'COD_COLLECTION';
export const LEDGER_SOURCE_COD_REMITTANCE = 'COD_REMITTANCE';
export const LEDGER_SOURCE_DRIVER_EARNING = 'DRIVER_EARNING';
export const LEDGER_SOURCE_REFUND = 'REFUND';
export const LEDGER_SOURCE_MERCHANT_SETTLEMENT = 'MERCHANT_SETTLEMENT';

export const LEDGER_SOURCES = [
  LEDGER_SOURCE_PAYMENT,
  LEDGER_SOURCE_COD_COLLECTION,
  LEDGER_SOURCE_COD_REMITTANCE,
  LEDGER_SOURCE_DRIVER_EARNING,
  LEDGER_SOURCE_REFUND,
  LEDGER_SOURCE_MERCHANT_SETTLEMENT,
] as const;

export type LedgerSourceType = (typeof LEDGER_SOURCES)[number];

export type FinancialLedgerEntryRecord = {
  id: string;
  orderId: string | null;
  merchantId: string | null;
  driverId: string | null;
  type: string;
  direction: LedgerDirection;
  amountMinor: number;
  currency: string;
  reversalOfId: string | null;
  reference: string;
  createdAt: string;
};

export type LedgerListQuery = {
  type?: string;
  direction?: LedgerDirection;
  reference?: string;
  orderId?: string;
  merchantId?: string;
  driverId?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  offset?: number;
};

export const LEDGER_LIST_DEFAULT_LIMIT = 50;
export const LEDGER_LIST_MAX_LIMIT = 100;

export type MerchantLedgerPosition = {
  merchantId: string;
  currency: typeof LEDGER_CURRENCY_DZD;
  creditMinor: number;
  debitMinor: number;
  /** CREDIT − DEBIT for MERCHANT_PAYABLE (positive = SpeedyGo owes Merchant). */
  netPayableMinor: number;
};

export type DriverLedgerPositions = {
  driverId: string;
  currency: typeof LEDGER_CURRENCY_DZD;
  /** CREDIT − DEBIT DRIVER_PAYABLE (outstanding unpaid earnings). */
  driverPayableMinor: number;
  /** DEBIT − CREDIT COD_CUSTODY (cash still held by Driver). */
  codCustodyMinor: number;
};
