import type { MerchantFinanceAccess } from '../../merchants/domain/merchant.policy';
import type {
  MerchantReportPeriodView,
  MerchantReportScopeView,
} from './merchant-sales-report.types';

/**
 * - `OK`: every counted COMPLETED Order has its immutable snapshot.
 * - `MISSING_FINANCIAL_SNAPSHOT`: money fields are withheld (null), never zero.
 */
export type MerchantDailySummaryDataStatus =
  'OK' | 'MISSING_FINANCIAL_SNAPSHOT';

export type MerchantDailySummaryBreakdownView = {
  /** Day Orders currently COMPLETED. */
  completed: number;
  /** Day Orders currently CREATED | CONFIRMED | ACTIVE. */
  inProgress: number;
  /** Day Orders currently CANCELLED. */
  cancelled: number;
  /** Day Orders currently FAILED. */
  failed: number;
};

export type MerchantDailySummaryCancellationReasonView = {
  /** Structured code, or `UNSET` for legacy / unstructured cancellations. */
  reasonCode: string;
  label: string;
  count: number;
};

export type MerchantDailySummaryView = {
  scope: MerchantReportScopeView;
  /** Local civil day (Africa/Algiers), `YYYY-MM-DD`. */
  date: string;
  period: MerchantReportPeriodView;
  asOf: string;
  currency: 'DZD';
  dataStatus: MerchantDailySummaryDataStatus;
  financeAccess: MerchantFinanceAccess;

  /** Orders with `createdAt` inside the day window. */
  ordersCreatedCount: number;
  /** COMPLETED Orders with `completedAt` inside the day window. */
  completedOrderCount: number;
  /** Cancellations with `cancelledAt` inside the day window. */
  cancelledOrderCount: number;
  /** Current non-terminal Orders on scope (not limited to the day). */
  activeOrderCount: number;
  breakdown: MerchantDailySummaryBreakdownView;

  /** Σ snapshot GMS of `completedOrderCount`; null when withheld. */
  grossMerchandiseMinor: string | null;
  /** floor(GMS / completedOrderCount); null when no sale or withheld. */
  averageBasketMinor: string | null;

  /** floor(mean whole minutes); null when `preparationSampleCount` is 0 (never 0). */
  averageActualPreparationMinutes: number | null;
  preparationSampleCount: number;
  /** Samples that also have an `estimatedReadyAt` to compare against. */
  onTimeLateSampleCount: number;
  onTimePreparationCount: number;
  latePreparationCount: number;
  /** floor(onTime / onTimeLateSampleCount * 10000); null without samples. */
  onTimePreparationRateBps: number | null;

  cancellationReasons: MerchantDailySummaryCancellationReasonView[];
};
