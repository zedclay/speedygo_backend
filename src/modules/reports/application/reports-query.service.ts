import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { formatRatingAverage } from '../../ratings/domain/ratings.policy';
import { COD_REMITTANCE_STATUS_CONFIRMED } from '../../cod/domain/cod.policy';
import { DRIVER_EARNING_STATUS_EARNED } from '../../driver-remuneration/domain/driver-remuneration.types';
import { DELIVERY_STATUS_DELIVERED } from '../../delivery/domain/delivery.policy';
import {
  moneyMinorToString,
  normalizeReportListQuery,
  validateReportWindow,
} from '../domain/reports.policy';
import { reportsInvalidInput } from '../domain/reports.errors';
import type {
  CodFinanceReportDto,
  CompletedOrdersFinanceReportDto,
  DeliveriesOperationsReportDto,
  DriverEarningsFinanceReportDto,
  DriverOperationsListReportDto,
  MerchantFinanceListReportDto,
  OrdersOperationsReportDto,
  PaymentsFinanceReportDto,
  PromotionsFinanceReportDto,
  RatingsOperationsReportDto,
  RefundsFinanceReportDto,
  ReportWindowMeta,
  SettlementsFinanceReportDto,
  SupportOperationsReportDto,
} from '../domain/reports.types';

export type OrmClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

async function consumeQueryRows<T>(result: unknown): Promise<T[]> {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (
    result != null &&
    typeof (result as Promise<unknown>).then === 'function'
  ) {
    return consumeQueryRows(await (result as Promise<unknown>));
  }
  if (
    result != null &&
    typeof result === 'object' &&
    Symbol.asyncIterator in result
  ) {
    const rows: T[] = [];
    for await (const row of result as AsyncIterable<T>) {
      rows.push(row);
    }
    return rows;
  }
  throw new Error('Reports query returned an unexpected result');
}

function windowMeta(from: Date, to: Date): ReportWindowMeta {
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    interval: '[from, to)',
    timezone: 'UTC_INSTANTS',
  };
}

function resolveWindow(
  fromRaw: string,
  toRaw: string,
): {
  from: Date;
  to: Date;
  fromIso: string;
  toIso: string;
  window: ReportWindowMeta;
} {
  const parsed = validateReportWindow(fromRaw, toRaw);
  if ('error' in parsed) {
    throw reportsInvalidInput(parsed.error);
  }
  const fromIso = parsed.from.toISOString();
  const toIso = parsed.to.toISOString();
  return {
    from: parsed.from,
    to: parsed.to,
    fromIso,
    toIso,
    window: windowMeta(parsed.from, parsed.to),
  };
}

@Injectable()
export class ReportsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  private async queryRows<T>(plan: unknown, client?: OrmClient): Promise<T[]> {
    if (client?.query) {
      return consumeQueryRows<T>(client.query(plan));
    }
    return consumeQueryRows<T>(
      this.db()
        .runtime()
        .query(plan as never),
    );
  }

  private async runConsistentRead<T>(
    fn: (tx: OrmClient) => Promise<T>,
  ): Promise<T> {
    return this.db().transaction(async (tx: OrmClient) => fn(tx));
  }

  async getOrdersOperations(input: {
    from: string;
    to: string;
  }): Promise<OrdersOperationsReportDto> {
    const { fromIso, toIso, window } = resolveWindow(input.from, input.to);
    return this.runConsistentRead(async (tx) => {
      const statusPlan = this.db().raw.sql`
          SELECT status::text AS status, COUNT(*)::int4 AS cnt
          FROM orders
          WHERE created_at >= ${fromIso}::timestamptz
            AND created_at < ${toIso}::timestamptz
          GROUP BY status
        `
        .returnsRow({
          status: 'sql/varchar@1',
          cnt: 'pg/int4@1',
        })
        .build();
      const statusRows = await this.queryRows<{
        status: string;
        cnt: number;
      }>(statusPlan, tx);

      const completedPlan = this.db().raw.sql`
          SELECT COUNT(*)::int4 AS cnt
          FROM orders
          WHERE status = 'COMPLETED'
            AND completed_at IS NOT NULL
            AND completed_at >= ${fromIso}::timestamptz
            AND completed_at < ${toIso}::timestamptz
        `
        .returnsRow({ cnt: 'pg/int4@1' })
        .build();
      const completedRows = await this.queryRows<{ cnt: number }>(
        completedPlan,
        tx,
      );

      const ordersCreatedByStatus: Record<string, number> = {};
      let ordersCreatedCount = 0;
      let ordersCancelledCount = 0;
      let ordersFailedCount = 0;
      for (const row of statusRows) {
        const count = Number(row.cnt);
        ordersCreatedByStatus[String(row.status)] = count;
        ordersCreatedCount += count;
        if (row.status === 'CANCELLED') {
          ordersCancelledCount = count;
        }
        if (row.status === 'FAILED') {
          ordersFailedCount = count;
        }
      }

      return {
        window,
        ordersCreatedCount,
        ordersCompletedCount: Number(completedRows[0]?.cnt ?? 0),
        ordersCancelledCount,
        ordersFailedCount,
        ordersCreatedByStatus,
      };
    });
  }

  async getDeliveriesOperations(input: {
    from: string;
    to: string;
  }): Promise<DeliveriesOperationsReportDto> {
    const { fromIso, toIso, window } = resolveWindow(input.from, input.to);
    const plan = this.db().raw.sql`
        SELECT COUNT(*)::int4 AS cnt
        FROM deliveries
        WHERE status = ${DELIVERY_STATUS_DELIVERED}
          AND delivered_at IS NOT NULL
          AND delivered_at >= ${fromIso}::timestamptz
          AND delivered_at < ${toIso}::timestamptz
      `
      .returnsRow({ cnt: 'pg/int4@1' })
      .build();
    const rows = await this.queryRows<{ cnt: number }>(plan);
    return {
      window,
      deliveriesDeliveredCount: Number(rows[0]?.cnt ?? 0),
    };
  }

  async getSupportOperations(input: {
    from: string;
    to: string;
  }): Promise<SupportOperationsReportDto> {
    const { fromIso, toIso, window } = resolveWindow(input.from, input.to);
    return this.runConsistentRead(async (tx) => {
      const byStatusPlan = this.db().raw.sql`
          SELECT status::text AS status, COUNT(*)::int4 AS cnt
          FROM support_tickets
          WHERE created_at >= ${fromIso}::timestamptz
            AND created_at < ${toIso}::timestamptz
          GROUP BY status
        `
        .returnsRow({
          status: 'sql/varchar@1',
          cnt: 'pg/int4@1',
        })
        .build();
      const byPriorityPlan = this.db().raw.sql`
          SELECT priority::text AS priority, COUNT(*)::int4 AS cnt
          FROM support_tickets
          WHERE created_at >= ${fromIso}::timestamptz
            AND created_at < ${toIso}::timestamptz
          GROUP BY priority
        `
        .returnsRow({
          priority: 'sql/varchar@1',
          cnt: 'pg/int4@1',
        })
        .build();
      const statusRows = await this.queryRows<{
        status: string;
        cnt: number;
      }>(byStatusPlan, tx);
      const priorityRows = await this.queryRows<{
        priority: string;
        cnt: number;
      }>(byPriorityPlan, tx);

      const ticketsCreatedByStatus: Record<string, number> = {};
      let ticketsCreatedCount = 0;
      for (const row of statusRows) {
        const count = Number(row.cnt);
        ticketsCreatedByStatus[String(row.status)] = count;
        ticketsCreatedCount += count;
      }
      const ticketsCreatedByPriority: Record<string, number> = {};
      for (const row of priorityRows) {
        ticketsCreatedByPriority[String(row.priority)] = Number(row.cnt);
      }
      return {
        window,
        ticketsCreatedCount,
        ticketsCreatedByStatus,
        ticketsCreatedByPriority,
      };
    });
  }

  async getRatingsOperations(input: {
    from: string;
    to: string;
  }): Promise<RatingsOperationsReportDto> {
    const { fromIso, toIso, window } = resolveWindow(input.from, input.to);
    return this.runConsistentRead(async (tx) => {
      const driverPlan = this.db().raw.sql`
          SELECT
            COUNT(*)::int4 AS rating_count,
            COALESCE(SUM(score), 0)::int4 AS score_sum
          FROM driver_ratings
          WHERE created_at >= ${fromIso}::timestamptz
            AND created_at < ${toIso}::timestamptz
        `
        .returnsRow({
          rating_count: 'pg/int4@1',
          score_sum: 'pg/int4@1',
        })
        .build();
      const merchantPlan = this.db().raw.sql`
          SELECT
            COUNT(*)::int4 AS rating_count,
            COALESCE(SUM(score), 0)::int4 AS score_sum
          FROM merchant_ratings
          WHERE created_at >= ${fromIso}::timestamptz
            AND created_at < ${toIso}::timestamptz
        `
        .returnsRow({
          rating_count: 'pg/int4@1',
          score_sum: 'pg/int4@1',
        })
        .build();
      const driverRows = await this.queryRows<{
        rating_count: number;
        score_sum: number;
      }>(driverPlan, tx);
      const merchantRows = await this.queryRows<{
        rating_count: number;
        score_sum: number;
      }>(merchantPlan, tx);
      const driverCount = Number(driverRows[0]?.rating_count ?? 0);
      const driverSum = Number(driverRows[0]?.score_sum ?? 0);
      const merchantCount = Number(merchantRows[0]?.rating_count ?? 0);
      const merchantSum = Number(merchantRows[0]?.score_sum ?? 0);
      return {
        window,
        driverRatingsCreatedCount: driverCount,
        merchantRatingsCreatedCount: merchantCount,
        driverRatingScoreSum: driverSum,
        merchantRatingScoreSum: merchantSum,
        driverRatingAverage: formatRatingAverage(driverSum, driverCount),
        merchantRatingAverage: formatRatingAverage(merchantSum, merchantCount),
      };
    });
  }

  async getCompletedOrdersFinance(input: {
    from: string;
    to: string;
  }): Promise<CompletedOrdersFinanceReportDto> {
    const { fromIso, toIso, window } = resolveWindow(input.from, input.to);
    const plan = this.db().raw.sql`
        SELECT
          COUNT(*)::int4 AS completed_order_count,
          COALESCE(SUM(s.gross_merchandise_subtotal_minor), 0)::bigint AS gms,
          COALESCE(SUM(s.merchant_commission_amount_minor), 0)::bigint AS commission,
          COALESCE(SUM(s.merchant_discount_minor), 0)::bigint AS merchant_discount,
          COALESCE(SUM(s.platform_discount_minor), 0)::bigint AS platform_discount,
          COALESCE(SUM(s.merchant_net_amount_minor), 0)::bigint AS merchant_net,
          COALESCE(SUM(s.customer_delivery_fee_minor), 0)::bigint AS delivery_fee,
          COALESCE(SUM(s.driver_remuneration_minor), 0)::bigint AS driver_remuneration,
          COALESCE(SUM(s.speedygo_delivery_share_minor), 0)::bigint AS delivery_share,
          COALESCE(SUM(s.customer_payable_minor), 0)::bigint AS customer_payable
        FROM orders o
        INNER JOIN order_financial_snapshots s ON s.order_id = o.id
        WHERE o.status = 'COMPLETED'
          AND o.completed_at IS NOT NULL
          AND o.completed_at >= ${fromIso}::timestamptz
          AND o.completed_at < ${toIso}::timestamptz
      `
      .returnsRow({
        completed_order_count: 'pg/int4@1',
        gms: 'pg/int8@1',
        commission: 'pg/int8@1',
        merchant_discount: 'pg/int8@1',
        platform_discount: 'pg/int8@1',
        merchant_net: 'pg/int8@1',
        delivery_fee: 'pg/int8@1',
        driver_remuneration: 'pg/int8@1',
        delivery_share: 'pg/int8@1',
        customer_payable: 'pg/int8@1',
      })
      .build();
    const rows = await this.queryRows<{
      completed_order_count: number;
      gms: bigint | string | number;
      commission: bigint | string | number;
      merchant_discount: bigint | string | number;
      platform_discount: bigint | string | number;
      merchant_net: bigint | string | number;
      delivery_fee: bigint | string | number;
      driver_remuneration: bigint | string | number;
      delivery_share: bigint | string | number;
      customer_payable: bigint | string | number;
    }>(plan);
    const row = rows[0];
    return {
      window,
      completedOrderCount: Number(row?.completed_order_count ?? 0),
      grossMerchandiseMinor: moneyMinorToString(row?.gms),
      merchantCommissionMinor: moneyMinorToString(row?.commission),
      merchantDiscountMinor: moneyMinorToString(row?.merchant_discount),
      platformDiscountMinor: moneyMinorToString(row?.platform_discount),
      merchantNetMinor: moneyMinorToString(row?.merchant_net),
      customerDeliveryFeeMinor: moneyMinorToString(row?.delivery_fee),
      driverRemunerationMinor: moneyMinorToString(row?.driver_remuneration),
      speedyGoDeliveryShareMinor: moneyMinorToString(row?.delivery_share),
      customerPayableMinor: moneyMinorToString(row?.customer_payable),
    };
  }

  async getPaymentsFinance(input: {
    from: string;
    to: string;
  }): Promise<PaymentsFinanceReportDto> {
    const { fromIso, toIso, window } = resolveWindow(input.from, input.to);
    // Authoritative success event time — NOT Payment.updatedAt (lockPayment mutates it).
    const plan = this.db().raw.sql`
        SELECT
          COUNT(*)::int4 AS cnt,
          COALESCE(SUM(p.amount_minor), 0)::bigint AS amount_sum
        FROM payments p
        WHERE p.status = 'SUCCEEDED'
          AND (
            CASE
              WHEN p.method = 'ELECTRONIC' THEN (
                SELECT MIN(t.processed_at)
                FROM payment_transactions t
                WHERE t.payment_id = p.id
                  AND t.status = 'SUCCEEDED'
                  AND t.processed_at IS NOT NULL
              )
              WHEN p.method = 'COD' THEN (
                SELECT c.collected_at
                FROM cod_collections c
                WHERE c.order_id = p.order_id
              )
              ELSE NULL
            END
          ) >= ${fromIso}::timestamptz
          AND (
            CASE
              WHEN p.method = 'ELECTRONIC' THEN (
                SELECT MIN(t.processed_at)
                FROM payment_transactions t
                WHERE t.payment_id = p.id
                  AND t.status = 'SUCCEEDED'
                  AND t.processed_at IS NOT NULL
              )
              WHEN p.method = 'COD' THEN (
                SELECT c.collected_at
                FROM cod_collections c
                WHERE c.order_id = p.order_id
              )
              ELSE NULL
            END
          ) < ${toIso}::timestamptz
      `
      .returnsRow({
        cnt: 'pg/int4@1',
        amount_sum: 'pg/int8@1',
      })
      .build();
    const rows = await this.queryRows<{
      cnt: number;
      amount_sum: bigint | string | number;
    }>(plan);
    return {
      window,
      paymentSucceededDuringPeriodCount: Number(rows[0]?.cnt ?? 0),
      customerPaymentSucceededDuringPeriodMinor: moneyMinorToString(
        rows[0]?.amount_sum,
      ),
      successEventSource:
        'PAYMENT_TRANSACTION_PROCESSED_AT_OR_COD_COLLECTED_AT',
    };
  }

  async getRefundsFinance(input: {
    from: string;
    to: string;
  }): Promise<RefundsFinanceReportDto> {
    const { fromIso, toIso, window } = resolveWindow(input.from, input.to);
    const plan = this.db().raw.sql`
        SELECT
          COUNT(*)::int4 AS cnt,
          COALESCE(SUM(amount_minor), 0)::bigint AS amount_sum
        FROM refunds
        WHERE status = 'REFUNDED'
          AND completed_at IS NOT NULL
          AND completed_at >= ${fromIso}::timestamptz
          AND completed_at < ${toIso}::timestamptz
      `
      .returnsRow({
        cnt: 'pg/int4@1',
        amount_sum: 'pg/int8@1',
      })
      .build();
    const rows = await this.queryRows<{
      cnt: number;
      amount_sum: bigint | string | number;
    }>(plan);
    return {
      window,
      refundCompletedCount: Number(rows[0]?.cnt ?? 0),
      customerRefundedMinor: moneyMinorToString(rows[0]?.amount_sum),
    };
  }

  async getCodFinance(input: {
    from: string;
    to: string;
  }): Promise<CodFinanceReportDto> {
    const { fromIso, toIso, window } = resolveWindow(input.from, input.to);
    return this.runConsistentRead(async (tx) => {
      const collectedPlan = this.db().raw.sql`
          SELECT
            COUNT(*)::int4 AS cnt,
            COALESCE(SUM(collected_amount_minor), 0)::bigint AS amount_sum
          FROM cod_collections
          WHERE collected_at >= ${fromIso}::timestamptz
            AND collected_at < ${toIso}::timestamptz
        `
        .returnsRow({
          cnt: 'pg/int4@1',
          amount_sum: 'pg/int8@1',
        })
        .build();
      const remittedPlan = this.db().raw.sql`
          SELECT
            COUNT(*)::int4 AS cnt,
            COALESCE(SUM(confirmed_amount_minor), 0)::bigint AS amount_sum
          FROM cod_remittances
          WHERE status = ${COD_REMITTANCE_STATUS_CONFIRMED}
            AND confirmed_at IS NOT NULL
            AND confirmed_at >= ${fromIso}::timestamptz
            AND confirmed_at < ${toIso}::timestamptz
        `
        .returnsRow({
          cnt: 'pg/int4@1',
          amount_sum: 'pg/int8@1',
        })
        .build();
      // As-of exclusive end `to`: all history before `to` (not limited by `from`).
      const outstandingPlan = this.db().raw.sql`
          SELECT
            (
              COALESCE((
                SELECT SUM(collected_amount_minor)
                FROM cod_collections
                WHERE status = 'COLLECTED'
                  AND collected_at < ${toIso}::timestamptz
              ), 0)
              -
              COALESCE((
                SELECT SUM(a.allocated_amount_minor)
                FROM cod_remittance_allocations a
                INNER JOIN cod_remittances r ON r.id = a.remittance_id
                WHERE r.status = ${COD_REMITTANCE_STATUS_CONFIRMED}
                  AND r.confirmed_at IS NOT NULL
                  AND r.confirmed_at < ${toIso}::timestamptz
              ), 0)
            )::bigint AS outstanding_minor
        `
        .returnsRow({
          outstanding_minor: 'pg/int8@1',
        })
        .build();
      const discrepancyPlan = this.db().raw.sql`
          SELECT
            COUNT(*)::int4 AS cnt,
            COALESCE(SUM(difference_minor), 0)::bigint AS difference_sum
          FROM cod_discrepancies
          WHERE created_at >= ${fromIso}::timestamptz
            AND created_at < ${toIso}::timestamptz
        `
        .returnsRow({
          cnt: 'pg/int4@1',
          difference_sum: 'pg/int8@1',
        })
        .build();

      const collected = await this.queryRows<{
        cnt: number;
        amount_sum: bigint | string | number;
      }>(collectedPlan, tx);
      const remitted = await this.queryRows<{
        cnt: number;
        amount_sum: bigint | string | number;
      }>(remittedPlan, tx);
      const outstanding = await this.queryRows<{
        outstanding_minor: bigint | string | number;
      }>(outstandingPlan, tx);
      const discrepancy = await this.queryRows<{
        cnt: number;
        difference_sum: bigint | string | number;
      }>(discrepancyPlan, tx);

      const collectedMinor = BigInt(
        moneyMinorToString(collected[0]?.amount_sum),
      );
      const remittedMinor = BigInt(moneyMinorToString(remitted[0]?.amount_sum));

      return {
        window,
        codCollectedDuringPeriodCount: Number(collected[0]?.cnt ?? 0),
        codCollectedDuringPeriodMinor: moneyMinorToString(
          collected[0]?.amount_sum,
        ),
        codConfirmedRemittedDuringPeriodCount: Number(remitted[0]?.cnt ?? 0),
        codConfirmedRemittedDuringPeriodMinor: moneyMinorToString(
          remitted[0]?.amount_sum,
        ),
        codCustodyNetMovementDuringPeriodMinor: moneyMinorToString(
          collectedMinor - remittedMinor,
        ),
        codOutstandingCustodyAsOfToMinor: moneyMinorToString(
          outstanding[0]?.outstanding_minor,
        ),
        codDiscrepancyCreatedDuringPeriodCount: Number(
          discrepancy[0]?.cnt ?? 0,
        ),
        codDiscrepancyDifferenceDuringPeriodMinorSum: moneyMinorToString(
          discrepancy[0]?.difference_sum,
        ),
      };
    });
  }

  async getDriverEarningsFinance(input: {
    from: string;
    to: string;
  }): Promise<DriverEarningsFinanceReportDto> {
    const { fromIso, toIso, window } = resolveWindow(input.from, input.to);
    const plan = this.db().raw.sql`
        SELECT
          COUNT(*)::int4 AS cnt,
          COALESCE(SUM(net_earning_minor), 0)::bigint AS amount_sum
        FROM driver_earnings
        WHERE status = ${DRIVER_EARNING_STATUS_EARNED}
          AND created_at >= ${fromIso}::timestamptz
          AND created_at < ${toIso}::timestamptz
      `
      .returnsRow({
        cnt: 'pg/int4@1',
        amount_sum: 'pg/int8@1',
      })
      .build();
    const rows = await this.queryRows<{
      cnt: number;
      amount_sum: bigint | string | number;
    }>(plan);
    return {
      window,
      driverEarningRowCount: Number(rows[0]?.cnt ?? 0),
      driverEarnedMinor: moneyMinorToString(rows[0]?.amount_sum),
    };
  }

  async getSettlementsFinance(input: {
    from: string;
    to: string;
  }): Promise<SettlementsFinanceReportDto> {
    const { fromIso, toIso, window } = resolveWindow(input.from, input.to);
    const plan = this.db().raw.sql`
        SELECT
          COUNT(*)::int4 AS created_count,
          COUNT(*) FILTER (WHERE status = 'DRAFT')::int4 AS draft_count,
          COUNT(*) FILTER (WHERE status = 'FINALIZED')::int4 AS finalized_count,
          COALESCE(
            SUM(net_payable_minor) FILTER (WHERE status = 'FINALIZED'),
            0
          )::bigint AS finalized_net
        FROM merchant_settlements
        WHERE created_at >= ${fromIso}::timestamptz
          AND created_at < ${toIso}::timestamptz
      `
      .returnsRow({
        created_count: 'pg/int4@1',
        draft_count: 'pg/int4@1',
        finalized_count: 'pg/int4@1',
        finalized_net: 'pg/int8@1',
      })
      .build();
    const rows = await this.queryRows<{
      created_count: number;
      draft_count: number;
      finalized_count: number;
      finalized_net: bigint | string | number;
    }>(plan);
    return {
      window,
      settlementsCreatedDuringPeriodCount: Number(rows[0]?.created_count ?? 0),
      settlementsCreatedCurrentlyDraftCount: Number(rows[0]?.draft_count ?? 0),
      settlementsCreatedCurrentlyFinalizedCount: Number(
        rows[0]?.finalized_count ?? 0,
      ),
      settlementsCreatedCurrentlyFinalizedNetPayableMinor: moneyMinorToString(
        rows[0]?.finalized_net,
      ),
    };
  }

  async getPromotionsFinance(input: {
    from: string;
    to: string;
  }): Promise<PromotionsFinanceReportDto> {
    const { fromIso, toIso, window } = resolveWindow(input.from, input.to);
    const plan = this.db().raw.sql`
        SELECT
          COUNT(*)::int4 AS completed_order_count,
          COALESCE(SUM(s.merchant_discount_minor), 0)::bigint AS merchant_discount,
          COALESCE(SUM(s.platform_discount_minor), 0)::bigint AS platform_discount
        FROM orders o
        INNER JOIN order_financial_snapshots s ON s.order_id = o.id
        WHERE o.status = 'COMPLETED'
          AND o.completed_at IS NOT NULL
          AND o.completed_at >= ${fromIso}::timestamptz
          AND o.completed_at < ${toIso}::timestamptz
      `
      .returnsRow({
        completed_order_count: 'pg/int4@1',
        merchant_discount: 'pg/int8@1',
        platform_discount: 'pg/int8@1',
      })
      .build();
    const rows = await this.queryRows<{
      completed_order_count: number;
      merchant_discount: bigint | string | number;
      platform_discount: bigint | string | number;
    }>(plan);
    return {
      window,
      completedOrderCount: Number(rows[0]?.completed_order_count ?? 0),
      merchantFundedDiscountMinor: moneyMinorToString(
        rows[0]?.merchant_discount,
      ),
      platformFundedDiscountMinor: moneyMinorToString(
        rows[0]?.platform_discount,
      ),
    };
  }

  async listMerchantFinance(input: {
    from: string;
    to: string;
    limit?: number;
    offset?: number;
  }): Promise<MerchantFinanceListReportDto> {
    const { fromIso, toIso, window } = resolveWindow(input.from, input.to);
    const page = normalizeReportListQuery(input);
    return this.runConsistentRead(async (tx) => {
      const countPlan = this.db().raw.sql`
          SELECT COUNT(*)::int4 AS total
          FROM (
            SELECT b.merchant_id
            FROM orders o
            INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
            INNER JOIN order_financial_snapshots s ON s.order_id = o.id
            WHERE o.status = 'COMPLETED'
              AND o.completed_at IS NOT NULL
              AND o.completed_at >= ${fromIso}::timestamptz
              AND o.completed_at < ${toIso}::timestamptz
            GROUP BY b.merchant_id
          ) t
        `
        .returnsRow({ total: 'pg/int4@1' })
        .build();
      const pagePlan = this.db().raw.sql`
          SELECT
            b.merchant_id,
            COUNT(*)::int4 AS completed_order_count,
            COALESCE(SUM(s.gross_merchandise_subtotal_minor), 0)::bigint AS gms,
            COALESCE(SUM(s.merchant_commission_amount_minor), 0)::bigint AS commission,
            COALESCE(SUM(s.merchant_net_amount_minor), 0)::bigint AS merchant_net
          FROM orders o
          INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
          INNER JOIN order_financial_snapshots s ON s.order_id = o.id
          WHERE o.status = 'COMPLETED'
            AND o.completed_at IS NOT NULL
            AND o.completed_at >= ${fromIso}::timestamptz
            AND o.completed_at < ${toIso}::timestamptz
          GROUP BY b.merchant_id
          ORDER BY completed_order_count DESC, gms DESC, b.merchant_id ASC
          LIMIT ${page.limit}
          OFFSET ${page.offset}
        `
        .returnsRow({
          merchant_id: 'pg/uuid@1',
          completed_order_count: 'pg/int4@1',
          gms: 'pg/int8@1',
          commission: 'pg/int8@1',
          merchant_net: 'pg/int8@1',
        })
        .build();
      const totals = await this.queryRows<{ total: number }>(countPlan, tx);
      const rows = await this.queryRows<{
        merchant_id: string;
        completed_order_count: number;
        gms: bigint | string | number;
        commission: bigint | string | number;
        merchant_net: bigint | string | number;
      }>(pagePlan, tx);
      return {
        window,
        items: rows.map((row) => ({
          merchantId: String(row.merchant_id),
          completedOrderCount: Number(row.completed_order_count),
          grossMerchandiseMinor: moneyMinorToString(row.gms),
          merchantCommissionMinor: moneyMinorToString(row.commission),
          merchantNetMinor: moneyMinorToString(row.merchant_net),
        })),
        total: Number(totals[0]?.total ?? 0),
        limit: page.limit,
        offset: page.offset,
      };
    });
  }

  async listDriverOperations(input: {
    from: string;
    to: string;
    limit?: number;
    offset?: number;
  }): Promise<DriverOperationsListReportDto> {
    const { fromIso, toIso, window } = resolveWindow(input.from, input.to);
    const page = normalizeReportListQuery(input);
    return this.runConsistentRead(async (tx) => {
      const countPlan = this.db().raw.sql`
          SELECT COUNT(*)::int4 AS total
          FROM (
            SELECT a.driver_id
            FROM deliveries d
            INNER JOIN driver_assignments a ON a.delivery_id = d.id
            WHERE d.status = ${DELIVERY_STATUS_DELIVERED}
              AND d.delivered_at IS NOT NULL
              AND d.delivered_at >= ${fromIso}::timestamptz
              AND d.delivered_at < ${toIso}::timestamptz
              AND a.status = 'RELEASED'
              AND a.accepted_at IS NOT NULL
              AND a.released_at IS NOT NULL
            GROUP BY a.driver_id
          ) t
        `
        .returnsRow({ total: 'pg/int4@1' })
        .build();
      const pagePlan = this.db().raw.sql`
          SELECT
            a.driver_id,
            COUNT(*)::int4 AS completed_delivery_count
          FROM deliveries d
          INNER JOIN driver_assignments a ON a.delivery_id = d.id
          WHERE d.status = ${DELIVERY_STATUS_DELIVERED}
            AND d.delivered_at IS NOT NULL
            AND d.delivered_at >= ${fromIso}::timestamptz
            AND d.delivered_at < ${toIso}::timestamptz
            AND a.status = 'RELEASED'
            AND a.accepted_at IS NOT NULL
            AND a.released_at IS NOT NULL
          GROUP BY a.driver_id
          ORDER BY completed_delivery_count DESC, a.driver_id ASC
          LIMIT ${page.limit}
          OFFSET ${page.offset}
        `
        .returnsRow({
          driver_id: 'pg/uuid@1',
          completed_delivery_count: 'pg/int4@1',
        })
        .build();
      const totals = await this.queryRows<{ total: number }>(countPlan, tx);
      const rows = await this.queryRows<{
        driver_id: string;
        completed_delivery_count: number;
      }>(pagePlan, tx);
      return {
        window,
        items: rows.map((row) => ({
          driverId: String(row.driver_id),
          completedDeliveryCount: Number(row.completed_delivery_count),
        })),
        total: Number(totals[0]?.total ?? 0),
        limit: page.limit,
        offset: page.offset,
      };
    });
  }
}
