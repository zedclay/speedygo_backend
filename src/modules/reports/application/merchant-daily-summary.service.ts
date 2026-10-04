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
  cancellationReasonGroupKey,
  MERCHANT_CANCELLATION_REASON_LABELS_FR,
  MERCHANT_CANCELLATION_REASON_UNSET,
} from '../../orders/domain/merchant-cancellation-reason';
import type {
  MerchantDailySummaryCancellationReasonView,
  MerchantDailySummaryView,
} from '../domain/merchant-daily-summary.types';
import {
  MerchantReportPeriodError,
  resolveMerchantReportPeriod,
  type ResolvedMerchantReportPeriod,
} from '../domain/merchant-sales-report.period';
import {
  MERCHANT_REPORTS_CLOCK,
  type MerchantReportPeriodView,
  type MerchantReportsClock,
} from '../domain/merchant-sales-report.types';
import { reportsInvalidInput } from '../domain/reports.errors';
import { moneyMinorToString } from '../domain/reports.policy';
import { consumeQueryRows, type OrmClient } from './reports-query.service';

type Money = bigint | string | number;

export type MerchantDailySummaryQuery = {
  /** Local civil day `YYYY-MM-DD` (Africa/Algiers). Omitted = today. */
  date?: string;
  branchId?: string;
};

type Scope = {
  merchantId: string;
  /** '' = every Branch of the Merchant (text sentinel; never cast to uuid). */
  branchKey: string;
  financeGranted: boolean;
};

const REASON_ORDER: readonly string[] = [
  'PRODUCT_UNAVAILABLE',
  'TOO_BUSY',
  'CLOSING_SOON',
  'OTHER',
  MERCHANT_CANCELLATION_REASON_UNSET,
];

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
 * Merchant operational daily summary for one Africa/Algiers civil day.
 * Read-only; never invents targets, growth or delivery-delay minutes. See
 * docs/architecture/MERCHANT_DAILY_SUMMARY.md.
 */
@Injectable()
export class MerchantDailySummaryService {
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

  private resolvePeriod(date: string | undefined) {
    try {
      return resolveMerchantReportPeriod(
        date === undefined
          ? { period: 'TODAY', now: this.clock() }
          : { period: 'CUSTOM', now: this.clock(), from: date, to: date },
      );
    } catch (error) {
      if (error instanceof MerchantReportPeriodError) {
        throw reportsInvalidInput(error.message);
      }
      throw error;
    }
  }

  async getDailySummary(
    accountId: string,
    merchantId: string,
    query: MerchantDailySummaryQuery,
  ): Promise<MerchantDailySummaryView> {
    const scope = await this.resolveScope(
      accountId,
      merchantId,
      query.branchId,
    );
    const period = this.resolvePeriod(query.date);
    const fromIso = period.from.toISOString();
    const toIso = period.to.toISOString();
    const { branchKey } = scope;

    return this.db().transaction(async (tx: OrmClient) => {
      const dayOrdersPlan = this.db().raw.sql`
          SELECT
            COUNT(*)::int4 AS created_count,
            COUNT(*) FILTER (WHERE o.status = 'COMPLETED')::int4 AS completed,
            COUNT(*) FILTER (WHERE o.status IN ('CREATED', 'CONFIRMED', 'ACTIVE'))::int4 AS in_progress,
            COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int4 AS cancelled,
            COUNT(*) FILTER (WHERE o.status = 'FAILED')::int4 AS failed
          FROM orders o
          INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
          WHERE b.merchant_id = ${merchantId}::uuid
            AND (${branchKey} = '' OR o.merchant_branch_id::text = ${branchKey})
            AND o.created_at >= ${fromIso}::timestamptz
            AND o.created_at < ${toIso}::timestamptz
        `
        .returnsRow({
          created_count: 'pg/int4@1',
          completed: 'pg/int4@1',
          in_progress: 'pg/int4@1',
          cancelled: 'pg/int4@1',
          failed: 'pg/int4@1',
        })
        .build();
      const activePlan = this.db().raw.sql`
          SELECT COUNT(*)::int4 AS cnt
          FROM orders o
          INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
          WHERE b.merchant_id = ${merchantId}::uuid
            AND (${branchKey} = '' OR o.merchant_branch_id::text = ${branchKey})
            AND o.status IN ('CREATED', 'CONFIRMED', 'ACTIVE')
        `
        .returnsRow({ cnt: 'pg/int4@1' })
        .build();
      const salesPlan = this.db().raw.sql`
          SELECT
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
        `
        .returnsRow({
          completed_count: 'pg/int4@1',
          snapshot_count: 'pg/int4@1',
          gms: 'pg/int8@1',
        })
        .build();
      const reasonsPlan = this.db().raw.sql`
          SELECT
            COALESCE(c.reason_code, 'UNSET') AS reason_code,
            COUNT(*)::int4 AS cnt
          FROM orders o
          INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
          INNER JOIN order_cancellations c ON c.order_id = o.id
          WHERE b.merchant_id = ${merchantId}::uuid
            AND (${branchKey} = '' OR o.merchant_branch_id::text = ${branchKey})
            AND o.status = 'CANCELLED'
            AND c.cancelled_at >= ${fromIso}::timestamptz
            AND c.cancelled_at < ${toIso}::timestamptz
          GROUP BY 1
        `
        .returnsRow({ reason_code: 'pg/text@1', cnt: 'pg/int4@1' })
        .build();
      const preparationPlan = this.db().raw.sql`
          SELECT
            COUNT(*)::int4 AS sample_count,
            COALESCE(SUM(r.minutes), 0)::bigint AS total_minutes,
            COUNT(*) FILTER (WHERE r.has_estimate)::int4 AS estimate_sample_count,
            COUNT(*) FILTER (WHERE r.has_estimate AND r.on_time)::int4 AS on_time_count,
            COUNT(*) FILTER (WHERE r.has_estimate AND NOT r.on_time)::int4 AS late_count
          FROM (
            SELECT
              FLOOR(EXTRACT(EPOCH FROM (rd.ready_at - o.confirmed_at)) / 60)::int8 AS minutes,
              (o.estimated_ready_at IS NOT NULL) AS has_estimate,
              COALESCE(rd.ready_at <= o.estimated_ready_at, FALSE) AS on_time
            FROM orders o
            INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
            INNER JOIN LATERAL (
              SELECT MIN(e.occurred_at) AS ready_at
              FROM order_status_events e
              WHERE e.order_id = o.id
                AND e.event_type = 'ORDER_READY'
            ) rd ON rd.ready_at IS NOT NULL
            WHERE b.merchant_id = ${merchantId}::uuid
              AND (${branchKey} = '' OR o.merchant_branch_id::text = ${branchKey})
              AND o.created_at >= ${fromIso}::timestamptz
              AND o.created_at < ${toIso}::timestamptz
              AND o.confirmed_at IS NOT NULL
              AND rd.ready_at >= o.confirmed_at
              AND rd.ready_at - o.confirmed_at <= INTERVAL '24 hours'
          ) r
        `
        .returnsRow({
          sample_count: 'pg/int4@1',
          total_minutes: 'pg/int8@1',
          estimate_sample_count: 'pg/int4@1',
          on_time_count: 'pg/int4@1',
          late_count: 'pg/int4@1',
        })
        .build();

      const [dayOrders] = await this.queryRows<{
        created_count: number;
        completed: number;
        in_progress: number;
        cancelled: number;
        failed: number;
      }>(dayOrdersPlan, tx);
      const [active] = await this.queryRows<{ cnt: number }>(activePlan, tx);
      const [sales] = await this.queryRows<{
        completed_count: number;
        snapshot_count: number;
        gms: Money;
      }>(salesPlan, tx);
      const reasonRows = await this.queryRows<{
        reason_code: string;
        cnt: number;
      }>(reasonsPlan, tx);
      const [prep] = await this.queryRows<{
        sample_count: number;
        total_minutes: Money;
        estimate_sample_count: number;
        on_time_count: number;
        late_count: number;
      }>(preparationPlan, tx);

      const completedCount = Number(sales?.completed_count ?? 0);
      const complete = Number(sales?.snapshot_count ?? 0) === completedCount;
      const gms = complete ? moneyMinorToString(sales?.gms) : null;
      const averageBasketMinor =
        complete && completedCount > 0
          ? (
              BigInt(String(sales?.gms ?? 0)) / BigInt(completedCount)
            ).toString()
          : null;

      const byReason = new Map<string, number>();
      for (const row of reasonRows) {
        const key = cancellationReasonGroupKey(row.reason_code);
        byReason.set(key, (byReason.get(key) ?? 0) + Number(row.cnt));
      }
      const cancellationReasons: MerchantDailySummaryCancellationReasonView[] =
        REASON_ORDER.filter((key) => byReason.has(key)).map((key) => ({
          reasonCode: key,
          label:
            MERCHANT_CANCELLATION_REASON_LABELS_FR[
              key as keyof typeof MERCHANT_CANCELLATION_REASON_LABELS_FR
            ],
          count: byReason.get(key) ?? 0,
        }));
      const cancelledOrderCount = cancellationReasons.reduce(
        (sum, item) => sum + item.count,
        0,
      );

      const sampleCount = Number(prep?.sample_count ?? 0);
      const estimateSampleCount = Number(prep?.estimate_sample_count ?? 0);
      const onTimeCount = Number(prep?.on_time_count ?? 0);
      const averageActualPreparationMinutes =
        sampleCount > 0
          ? Number(
              BigInt(String(prep?.total_minutes ?? 0)) / BigInt(sampleCount),
            )
          : null;
      const onTimePreparationRateBps =
        estimateSampleCount > 0
          ? Number(
              (BigInt(onTimeCount) * 10_000n) / BigInt(estimateSampleCount),
            )
          : null;

      return {
        scope: {
          merchantId,
          branchId: branchKey === '' ? null : branchKey,
        },
        date: period.localFrom,
        period: periodView(period),
        asOf: period.asOf.toISOString(),
        currency: 'DZD' as const,
        dataStatus: complete
          ? ('OK' as const)
          : ('MISSING_FINANCIAL_SNAPSHOT' as const),
        financeAccess: scope.financeGranted
          ? ('GRANTED' as const)
          : ('ROLE_RESTRICTED' as const),
        ordersCreatedCount: Number(dayOrders?.created_count ?? 0),
        completedOrderCount: completedCount,
        cancelledOrderCount,
        activeOrderCount: Number(active?.cnt ?? 0),
        breakdown: {
          completed: Number(dayOrders?.completed ?? 0),
          inProgress: Number(dayOrders?.in_progress ?? 0),
          cancelled: Number(dayOrders?.cancelled ?? 0),
          failed: Number(dayOrders?.failed ?? 0),
        },
        grossMerchandiseMinor: gms,
        averageBasketMinor,
        averageActualPreparationMinutes,
        preparationSampleCount: sampleCount,
        onTimeLateSampleCount: estimateSampleCount,
        onTimePreparationCount: onTimeCount,
        latePreparationCount: Number(prep?.late_count ?? 0),
        onTimePreparationRateBps,
        cancellationReasons,
      };
    });
  }
}
