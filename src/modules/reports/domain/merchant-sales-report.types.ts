import type { MerchantFinanceAccess } from '../../merchants/domain/merchant.policy';
import type {
  MerchantReportGranularity,
  MerchantReportPeriod,
} from './merchant-sales-report.period';

export const MERCHANT_REPORTS_CLOCK = Symbol('MERCHANT_REPORTS_CLOCK');
export type MerchantReportsClock = () => Date;

export const MERCHANT_TOP_PRODUCT_SORTS = ['ORDERS', 'REVENUE'] as const;
export type MerchantTopProductSort =
  (typeof MERCHANT_TOP_PRODUCT_SORTS)[number];
export const MERCHANT_TOP_PRODUCTS_DEFAULT_LIMIT = 5;
export const MERCHANT_TOP_PRODUCTS_MAX_LIMIT = 50;

export type MerchantReportPeriodView = {
  period: MerchantReportPeriod;
  timezone: string;
  from: string;
  to: string;
  interval: '[from, to)';
  localFrom: string;
  localToInclusive: string;
};

export type MerchantReportScopeView = {
  merchantId: string;
  /** null = all Branches of the Merchant. */
  branchId: string | null;
};

/**
 * - `COMPLETE`: every counted COMPLETED Order has its immutable snapshot.
 * - `MISSING_FINANCIAL_SNAPSHOT`: money fields are withheld (null), never zero.
 */
export type MerchantReportDataStatus =
  'COMPLETE' | 'MISSING_FINANCIAL_SNAPSHOT';

/** `ROLE_RESTRICTED`: STAFF — no COMMISSION_READ / SETTLEMENT_READ capability. */
export type MerchantReportFinanceAccess = MerchantFinanceAccess;

export type MerchantSalesFinanceView = {
  merchantDiscountMinor: string | null;
  commissionMinor: string | null;
  merchantNetMinor: string | null;
  /** Snapshot rate when every counted Order shares it; otherwise null. */
  uniformCommissionRateBps: number | null;
  /** REFUNDED Customer refunds completed in the period on scoped Orders. */
  refundsCompletedCount: number;
  /**
   * Signed sum of recorded REFUND_ADJUSTMENT settlement lines (−merchant
   * liability) for those refunds. Not the Customer refund amount.
   */
  recordedRefundAdjustmentsMinor: string;
};

export type MerchantSalesTrendBucketView = {
  start: string;
  localStart: string;
  completedOrderCount: number;
  grossMerchandiseMinor: string | null;
};

export type MerchantSalesSummaryView = {
  scope: MerchantReportScopeView;
  period: MerchantReportPeriodView;
  asOf: string;
  currency: 'DZD';
  dataStatus: MerchantReportDataStatus;
  completedOrderCount: number;
  grossMerchandiseMinor: string | null;
  /** floor(gross / completed count); null when there are no completed Orders. */
  averageBasketMinor: string | null;
  cancelledOrderCount: number;
  financeAccess: MerchantReportFinanceAccess;
  finance: MerchantSalesFinanceView | null;
  trend: {
    granularity: MerchantReportGranularity;
    buckets: MerchantSalesTrendBucketView[];
  };
};

export type MerchantTopProductView = {
  rank: number;
  /** null when the Product was deleted after sale (historical line kept). */
  productId: string | null;
  name: string;
  orderCount: number;
  quantity: number;
  revenueMinor: string;
};

export type MerchantTopProductsView = {
  scope: MerchantReportScopeView;
  period: MerchantReportPeriodView;
  asOf: string;
  currency: 'DZD';
  sort: MerchantTopProductSort;
  distinctProductCount: number;
  items: MerchantTopProductView[];
};
