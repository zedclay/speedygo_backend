import { Inject, Injectable } from '@nestjs/common';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { MerchantAccessService } from '../../merchants/application/merchant-access.service';
import { merchantBranchNotFound } from '../../merchants/domain/merchant.errors';
import {
  MERCHANT_CAPABILITIES,
  merchantRoleHasFinanceAccess,
  parseMerchantMemberRole,
} from '../../merchants/domain/merchant.policy';
import { MerchantRepository } from '../../merchants/infrastructure/merchant.repository';
import {
  MerchantReportPeriodError,
  resolveMerchantReportPeriod,
  type MerchantReportPeriod,
  type ResolvedMerchantReportPeriod,
} from '../domain/merchant-sales-report.period';
import {
  MERCHANT_REPORTS_CLOCK,
  MERCHANT_TOP_PRODUCTS_DEFAULT_LIMIT,
  MERCHANT_TOP_PRODUCTS_MAX_LIMIT,
  type MerchantReportPeriodView,
  type MerchantReportsClock,
  type MerchantSalesSummaryView,
  type MerchantTopProductSort,
  type MerchantTopProductsView,
} from '../domain/merchant-sales-report.types';
import { reportsInvalidInput } from '../domain/reports.errors';
import { moneyMinorToString } from '../domain/reports.policy';
import { consumeQueryRows, type OrmClient } from './reports-query.service';

type Money = bigint | string | number;

export type MerchantReportQuery = {
  period: MerchantReportPeriod;
  from?: string;
  to?: string;
  branchId?: string;
};

type Scope = {
  merchantId: string;
  /** '' = every Branch of the Merchant (text sentinel; never cast to uuid). */
  branchKey: string;
  financeGranted: boolean;
};

function periodView(p: ResolvedMerchantReportPeriod): MerchantReportPeriodView {
  return {
    period: p.period,
    timezone: p.timezone,
    from: p.from.toISOString(),
    to: p.to.toISOString(),
    interval: '[from, to)',
    localFrom: p.localFrom,
    localToInclusive: p.localToInclusive,
  };
}

/**
 * Merchant-facing sales reports. Read-only projections over COMPLETED Orders
 * and their immutable OrderFinancialSnapshot / OrderItem rows. See
 * docs/architecture/MERCHANT_SALES_REPORTS.md.
 */
@Injectable()
export class MerchantSalesReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MerchantAccessService,
    private readonly merchants: MerchantRepository,
    @Inject(MERCHANT_REPORTS_CLOCK)
    private readonly clock: MerchantReportsClock,
  ) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  private async queryRows<T>(plan: unknown, client: OrmClient): Promise<T[]> {
    if (client.query) {
      return consumeQueryRows<T>(client.query(plan));
    }
    return consumeQueryRows<T>(
      this.db()
        .runtime()
        .query(plan as never),
    );
  }

  private async resolveScope(
    accountId: string,
    merchantId: string,
    branchId: string | undefined,
  ): Promise<Scope> {
    const context = await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.ORDER_READ,
    );
    if (branchId) {
      const branch = await this.merchants.findOwnedBranch(merchantId, branchId);
      if (!branch) {
        throw merchantBranchNotFound();
      }
    }
    const financeGranted = merchantRoleHasFinanceAccess(
      parseMerchantMemberRole(context.member.role),
    );
    return { merchantId, branchKey: branchId ?? '', financeGranted };
  }

  private resolvePeriod(query: MerchantReportQuery) {
    try {
      return resolveMerchantReportPeriod({
        period: query.period,
        now: this.clock(),
        from: query.from,
        to: query.to,
      });
    } catch (error) {
      if (error instanceof MerchantReportPeriodError) {
        throw reportsInvalidInput(error.message);
      }
      throw error;
    }
  }

  async getSalesSummary(
    accountId: string,
    merchantId: string,
    query: MerchantReportQuery,
  ): Promise<MerchantSalesSummaryView> {
    const scope = await this.resolveScope(
      accountId,
      merchantId,
      query.branchId,
    );
    const period = this.resolvePeriod(query);
    const fromIso = period.from.toISOString();
    const toIso = period.to.toISOString();
    const { branchKey } = scope;

    return this.db().transaction(async (tx: OrmClient) => {
      const summaryPlan = this.db().raw.sql`
          SELECT
            COUNT(*)::int4 AS completed_count,
            COUNT(s.order_id)::int4 AS snapshot_count,
            COALESCE(SUM(s.gross_merchandise_subtotal_minor), 0)::bigint AS gms,
            COALESCE(SUM(s.merchant_discount_minor), 0)::bigint AS merchant_discount,
            COALESCE(SUM(s.merchant_commission_amount_minor), 0)::bigint AS commission,
            COALESCE(SUM(s.merchant_net_amount_minor), 0)::bigint AS merchant_net,
            COUNT(DISTINCT s.merchant_commission_rate_bps)::int4 AS rate_count,
            COALESCE(MIN(s.merchant_commission_rate_bps), -1)::int4 AS min_rate
          FROM orders o
          INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
          LEFT JOIN order_financial_snapshots s ON s.order_id = o.id
          WHERE b.merchant_id = ${merchantId}::uuid
            AND (${branchKey} = '' OR o.merchant_branch_id::text = ${branchKey})
            AND o.status = 'COMPLETED'
            AND o.completed_at IS NOT NULL
            AND o.completed_at >= ${fromIso}::timestamptz
            AND o.completed_at < ${toIso}::timestamptz
        `
        .returnsRow({
          completed_count: 'pg/int4@1',
          snapshot_count: 'pg/int4@1',
          gms: 'pg/int8@1',
          merchant_discount: 'pg/int8@1',
          commission: 'pg/int8@1',
          merchant_net: 'pg/int8@1',
          rate_count: 'pg/int4@1',
          min_rate: 'pg/int4@1',
        })
        .build();
      const cancelledPlan = this.db().raw.sql`
          SELECT COUNT(*)::int4 AS cnt
          FROM orders o
          INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
          INNER JOIN order_cancellations c ON c.order_id = o.id
          WHERE b.merchant_id = ${merchantId}::uuid
            AND (${branchKey} = '' OR o.merchant_branch_id::text = ${branchKey})
            AND o.status = 'CANCELLED'
            AND c.cancelled_at >= ${fromIso}::timestamptz
            AND c.cancelled_at < ${toIso}::timestamptz
        `
        .returnsRow({ cnt: 'pg/int4@1' })
        .build();
      const trendPlan =
        period.granularity === 'HOUR'
          ? this.db().raw.sql`
          SELECT
            to_char(date_trunc('hour', o.completed_at AT TIME ZONE 'Africa/Algiers'), 'YYYY-MM-DD"T"HH24') AS bucket_key,
            COUNT(*)::int4 AS completed_count,
            COUNT(s.order_id)::int4 AS snapshot_count,
            COALESCE(SUM(s.gross_merchandise_subtotal_minor), 0)::bigint AS gms
          FROM orders o
          INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
          LEFT JOIN order_financial_snapshots s ON s.order_id = o.id
          WHERE b.merchant_id = ${merchantId}::uuid
            AND (${branchKey} = '' OR o.merchant_branch_id::text = ${branchKey})
            AND o.status = 'COMPLETED'
            AND o.completed_at IS NOT NULL
            AND o.completed_at >= ${fromIso}::timestamptz
            AND o.completed_at < ${toIso}::timestamptz
          GROUP BY 1
        `
              .returnsRow({
                bucket_key: 'pg/text@1',
                completed_count: 'pg/int4@1',
                snapshot_count: 'pg/int4@1',
                gms: 'pg/int8@1',
              })
              .build()
          : this.db().raw.sql`
          SELECT
            to_char(o.completed_at AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD') AS bucket_key,
            COUNT(*)::int4 AS completed_count,
            COUNT(s.order_id)::int4 AS snapshot_count,
            COALESCE(SUM(s.gross_merchandise_subtotal_minor), 0)::bigint AS gms
          FROM orders o
          INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
          LEFT JOIN order_financial_snapshots s ON s.order_id = o.id
          WHERE b.merchant_id = ${merchantId}::uuid
            AND (${branchKey} = '' OR o.merchant_branch_id::text = ${branchKey})
            AND o.status = 'COMPLETED'
            AND o.completed_at IS NOT NULL
            AND o.completed_at >= ${fromIso}::timestamptz
            AND o.completed_at < ${toIso}::timestamptz
          GROUP BY 1
        `
              .returnsRow({
                bucket_key: 'pg/text@1',
                completed_count: 'pg/int4@1',
                snapshot_count: 'pg/int4@1',
                gms: 'pg/int8@1',
              })
              .build();

      const [summary] = await this.queryRows<{
        completed_count: number;
        snapshot_count: number;
        gms: Money;
        merchant_discount: Money;
        commission: Money;
        merchant_net: Money;
        rate_count: number;
        min_rate: number;
      }>(summaryPlan, tx);
      const [cancelled] = await this.queryRows<{ cnt: number }>(
        cancelledPlan,
        tx,
      );
      const trendRows = await this.queryRows<{
        bucket_key: string;
        completed_count: number;
        snapshot_count: number;
        gms: Money;
      }>(trendPlan, tx);

      const completedCount = Number(summary?.completed_count ?? 0);
      const complete = Number(summary?.snapshot_count ?? 0) === completedCount;
      const gms = complete ? moneyMinorToString(summary?.gms) : null;
      const averageBasketMinor =
        complete && completedCount > 0
          ? (
              BigInt(String(summary?.gms ?? 0)) / BigInt(completedCount)
            ).toString()
          : null;

      const byKey = new Map(trendRows.map((row) => [row.bucket_key, row]));
      const buckets = period.buckets.map((bucket) => {
        const row = byKey.get(bucket.key);
        const count = Number(row?.completed_count ?? 0);
        const bucketComplete = Number(row?.snapshot_count ?? 0) === count;
        return {
          start: bucket.start.toISOString(),
          localStart: bucket.localStart,
          completedOrderCount: count,
          grossMerchandiseMinor:
            complete && bucketComplete ? moneyMinorToString(row?.gms) : null,
        };
      });

      let finance: MerchantSalesSummaryView['finance'] = null;
      if (scope.financeGranted) {
        const refundPlan = this.db().raw.sql`
            SELECT
              COUNT(*)::int4 AS refunds_count,
              COALESCE(SUM(adj.adjustment), 0)::bigint AS adjustments
            FROM refunds r
            INNER JOIN orders o ON o.id = r.order_id
            INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
            LEFT JOIN LATERAL (
              SELECT SUM(l.adjustment_minor) AS adjustment
              FROM merchant_settlement_lines l
              WHERE l.type = 'REFUND_ADJUSTMENT'
                AND l.reference = r.id::text
            ) adj ON TRUE
            WHERE b.merchant_id = ${merchantId}::uuid
              AND (${branchKey} = '' OR o.merchant_branch_id::text = ${branchKey})
              AND r.status = 'REFUNDED'
              AND r.completed_at IS NOT NULL
              AND r.completed_at >= ${fromIso}::timestamptz
              AND r.completed_at < ${toIso}::timestamptz
          `
          .returnsRow({ refunds_count: 'pg/int4@1', adjustments: 'pg/int8@1' })
          .build();
        const [refunds] = await this.queryRows<{
          refunds_count: number;
          adjustments: Money;
        }>(refundPlan, tx);
        finance = {
          merchantDiscountMinor: complete
            ? moneyMinorToString(summary?.merchant_discount)
            : null,
          commissionMinor: complete
            ? moneyMinorToString(summary?.commission)
            : null,
          merchantNetMinor: complete
            ? moneyMinorToString(summary?.merchant_net)
            : null,
          uniformCommissionRateBps:
            complete && Number(summary?.rate_count ?? 0) === 1
              ? Number(summary?.min_rate)
              : null,
          refundsCompletedCount: Number(refunds?.refunds_count ?? 0),
          recordedRefundAdjustmentsMinor: moneyMinorToString(
            refunds?.adjustments,
          ),
        };
      }

      return {
        scope: {
          merchantId,
          branchId: branchKey === '' ? null : branchKey,
        },
        period: periodView(period),
        asOf: period.asOf.toISOString(),
        currency: 'DZD' as const,
        dataStatus: complete
          ? ('COMPLETE' as const)
          : ('MISSING_FINANCIAL_SNAPSHOT' as const),
        completedOrderCount: completedCount,
        grossMerchandiseMinor: gms,
        averageBasketMinor,
        cancelledOrderCount: Number(cancelled?.cnt ?? 0),
        financeAccess: scope.financeGranted
          ? ('GRANTED' as const)
          : ('ROLE_RESTRICTED' as const),
        finance,
        trend: { granularity: period.granularity, buckets },
      };
    });
  }

  async getTopProducts(
    accountId: string,
    merchantId: string,
    query: MerchantReportQuery & {
      sort?: MerchantTopProductSort;
      limit?: number;
    },
  ): Promise<MerchantTopProductsView> {
    const scope = await this.resolveScope(
      accountId,
      merchantId,
      query.branchId,
    );
    const period = this.resolvePeriod(query);
    const fromIso = period.from.toISOString();
    const toIso = period.to.toISOString();
    const { branchKey } = scope;
    const sort: MerchantTopProductSort = query.sort ?? 'ORDERS';
    const limit = Math.min(
      MERCHANT_TOP_PRODUCTS_MAX_LIMIT,
      Math.max(
        1,
        Math.trunc(query.limit ?? MERCHANT_TOP_PRODUCTS_DEFAULT_LIMIT),
      ),
    );
    const rowShape = {
      product_key: 'pg/text@1',
      product_id: 'pg/text@1',
      name: 'pg/text@1',
      quantity: 'pg/int8@1',
      order_count: 'pg/int4@1',
      revenue: 'pg/int8@1',
    } as const;

    return this.db().transaction(async (tx: OrmClient) => {
      const countPlan = this.db().raw.sql`
          SELECT COUNT(DISTINCT COALESCE(i.product_id::text, 'name:' || i.product_name_snapshot))::int4 AS total
          FROM orders o
          INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
          INNER JOIN order_items i ON i.order_id = o.id
          WHERE b.merchant_id = ${merchantId}::uuid
            AND (${branchKey} = '' OR o.merchant_branch_id::text = ${branchKey})
            AND o.status = 'COMPLETED'
            AND o.completed_at IS NOT NULL
            AND o.completed_at >= ${fromIso}::timestamptz
            AND o.completed_at < ${toIso}::timestamptz
        `
        .returnsRow({ total: 'pg/int4@1' })
        .build();
      const rankedPlan =
        sort === 'REVENUE'
          ? this.db().raw.sql`
          SELECT
            COALESCE(i.product_id::text, 'name:' || i.product_name_snapshot) AS product_key,
            COALESCE(MAX(i.product_id::text), '') AS product_id,
            (array_agg(i.product_name_snapshot ORDER BY o.completed_at DESC, i.id DESC))[1] AS name,
            SUM(i.quantity)::bigint AS quantity,
            COUNT(DISTINCT i.order_id)::int4 AS order_count,
            SUM(i.line_total_minor)::bigint AS revenue
          FROM orders o
          INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
          INNER JOIN order_items i ON i.order_id = o.id
          WHERE b.merchant_id = ${merchantId}::uuid
            AND (${branchKey} = '' OR o.merchant_branch_id::text = ${branchKey})
            AND o.status = 'COMPLETED'
            AND o.completed_at IS NOT NULL
            AND o.completed_at >= ${fromIso}::timestamptz
            AND o.completed_at < ${toIso}::timestamptz
          GROUP BY 1
          ORDER BY revenue DESC, order_count DESC, quantity DESC, name ASC, product_key ASC
          LIMIT ${limit}
        `
              .returnsRow(rowShape)
              .build()
          : this.db().raw.sql`
          SELECT
            COALESCE(i.product_id::text, 'name:' || i.product_name_snapshot) AS product_key,
            COALESCE(MAX(i.product_id::text), '') AS product_id,
            (array_agg(i.product_name_snapshot ORDER BY o.completed_at DESC, i.id DESC))[1] AS name,
            SUM(i.quantity)::bigint AS quantity,
            COUNT(DISTINCT i.order_id)::int4 AS order_count,
            SUM(i.line_total_minor)::bigint AS revenue
          FROM orders o
          INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
          INNER JOIN order_items i ON i.order_id = o.id
          WHERE b.merchant_id = ${merchantId}::uuid
            AND (${branchKey} = '' OR o.merchant_branch_id::text = ${branchKey})
            AND o.status = 'COMPLETED'
            AND o.completed_at IS NOT NULL
            AND o.completed_at >= ${fromIso}::timestamptz
            AND o.completed_at < ${toIso}::timestamptz
          GROUP BY 1
          ORDER BY order_count DESC, quantity DESC, revenue DESC, name ASC, product_key ASC
          LIMIT ${limit}
        `
              .returnsRow(rowShape)
              .build();

      const [count] = await this.queryRows<{ total: number }>(countPlan, tx);
      const rows = await this.queryRows<{
        product_key: string;
        product_id: string;
        name: string;
        quantity: Money;
        order_count: number;
        revenue: Money;
      }>(rankedPlan, tx);

      return {
        scope: {
          merchantId,
          branchId: branchKey === '' ? null : branchKey,
        },
        period: periodView(period),
        asOf: period.asOf.toISOString(),
        currency: 'DZD' as const,
        sort,
        distinctProductCount: Number(count?.total ?? 0),
        items: rows.map((row, index) => ({
          rank: index + 1,
          productId: row.product_id === '' ? null : row.product_id,
          name: row.name,
          orderCount: Number(row.order_count),
          quantity: Number(row.quantity),
          revenueMinor: moneyMinorToString(row.revenue),
        })),
      };
    });
  }
}
