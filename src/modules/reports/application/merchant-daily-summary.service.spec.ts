import { MERCHANT_ERROR_CODES } from '../../merchants/domain/merchant.errors';
import { MERCHANT_CAPABILITIES } from '../../merchants/domain/merchant.policy';
import { REPORTS_ERROR_CODES } from '../domain/reports.errors';
import { MerchantDailySummaryService } from './merchant-daily-summary.service';

const ACCOUNT = '11111111-1111-7111-8111-111111111111';
const MERCHANT = '33333333-3333-7333-8333-333333333333';
const BRANCH = '66666666-6666-7666-8666-666666666666';
/** 11:00 in Africa/Algiers (UTC+1) on 2026-10-04. */
const NOW = new Date('2026-10-04T10:00:00.000Z');

type Plan = { sql: string };
type Rows = Record<string, unknown[]>;

function codeOf(error: unknown): string {
  return (error as { code: string }).code;
}

function buildService(options: {
  role?: string;
  branchOwned?: boolean;
  rows?: Rows;
}) {
  const role = options.role ?? 'OWNER';
  const rows: Rows = {
    'AS created_count': [
      {
        created_count: 0,
        completed: 0,
        in_progress: 0,
        cancelled: 0,
        failed: 0,
      },
    ],
    'SELECT COUNT(*)::int4 AS cnt': [{ cnt: 0 }],
    'AS snapshot_count': [{ completed_count: 0, snapshot_count: 0, gms: 0n }],
    'AS reason_code': [],
    'AS sample_count': [
      {
        sample_count: 0,
        total_minutes: 0n,
        estimate_sample_count: 0,
        on_time_count: 0,
        late_count: 0,
      },
    ],
    ...options.rows,
  };
  const plans: Array<{ sql: string; values: unknown[] }> = [];
  const tx = {
    orm: {},
    query: jest.fn((plan: unknown) => {
      const { sql } = plan as Plan;
      const key = Object.keys(rows).find((candidate) =>
        sql.includes(candidate),
      );
      if (!key) {
        throw new Error(`Unexpected query: ${sql}`);
      }
      return rows[key];
    }),
  };
  const db = {
    raw: {
      sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
        returnsRow: () => ({
          build: () => {
            const plan = { sql: strings.join('?'), values };
            plans.push(plan);
            return plan;
          },
        }),
      }),
    },
    transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    runtime: jest.fn(),
  };
  const prisma = { getDb: () => db };
  const access = {
    requireCapability: jest.fn().mockResolvedValue({
      member: { role },
      merchant: { id: MERCHANT },
    }),
  };
  const merchants = {
    findOwnedBranch: jest
      .fn()
      .mockResolvedValue(options.branchOwned === false ? null : { id: BRANCH }),
  };
  const service = new MerchantDailySummaryService(
    prisma as never,
    access as never,
    merchants as never,
    () => NOW,
  );
  return { service, access, merchants, db, plans };
}

describe('MerchantDailySummaryService', () => {
  it('requires ORDER_READ and rejects an unowned branch', async () => {
    const { service, access, merchants } = buildService({ branchOwned: false });
    await expect(
      service.getDailySummary(ACCOUNT, MERCHANT, { branchId: BRANCH }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND,
    });
    expect(access.requireCapability).toHaveBeenCalledWith(
      ACCOUNT,
      MERCHANT,
      MERCHANT_CAPABILITIES.ORDER_READ,
    );
    expect(merchants.findOwnedBranch).toHaveBeenCalledWith(MERCHANT, BRANCH);
  });

  it.each(['2026-13-01', '2026-02-30', '04-10-2026', 'yesterday'])(
    'rejects invalid date %s',
    async (date) => {
      const { service, db } = buildService({});
      const error = await service
        .getDailySummary(ACCOUNT, MERCHANT, { date })
        .catch((caught: unknown) => caught);
      expect(codeOf(error)).toBe(REPORTS_ERROR_CODES.REPORTS_INVALID_INPUT);
      expect(db.transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects a date after today in Africa/Algiers', async () => {
    const { service } = buildService({});
    const error = await service
      .getDailySummary(ACCOUNT, MERCHANT, { date: '2026-10-05' })
      .catch((caught: unknown) => caught);
    expect(codeOf(error)).toBe(REPORTS_ERROR_CODES.REPORTS_INVALID_INPUT);
  });

  it('defaults to today with a local-midnight half-open window', async () => {
    const { service } = buildService({});
    const view = await service.getDailySummary(ACCOUNT, MERCHANT, {});
    expect(view.date).toBe('2026-10-04');
    expect(view.period).toMatchObject({
      period: 'TODAY',
      timezone: 'Africa/Algiers',
      from: '2026-10-03T23:00:00.000Z',
      to: '2026-10-04T23:00:00.000Z',
      interval: '[from, to)',
    });
    expect(view.scope).toEqual({ merchantId: MERCHANT, branchId: null });
    expect(view.asOf).toBe(NOW.toISOString());
  });

  it('resolves an explicit past date as a single CUSTOM day', async () => {
    const { service, plans } = buildService({});
    const view = await service.getDailySummary(ACCOUNT, MERCHANT, {
      date: '2026-10-03',
      branchId: BRANCH,
    });
    expect(view.date).toBe('2026-10-03');
    expect(view.period).toMatchObject({
      period: 'CUSTOM',
      from: '2026-10-02T23:00:00.000Z',
      to: '2026-10-03T23:00:00.000Z',
    });
    expect(view.scope.branchId).toBe(BRANCH);
    expect(plans[0]?.values).toContain(BRANCH);
  });

  it('flags financeAccess by role without leaking commission or net', async () => {
    const owner = await buildService({ role: 'OWNER' }).service.getDailySummary(
      ACCOUNT,
      MERCHANT,
      {},
    );
    const staff = await buildService({ role: 'STAFF' }).service.getDailySummary(
      ACCOUNT,
      MERCHANT,
      {},
    );
    expect(owner.financeAccess).toBe('GRANTED');
    expect(staff.financeAccess).toBe('ROLE_RESTRICTED');
    for (const view of [owner, staff]) {
      expect(view).not.toHaveProperty('finance');
      expect(view).not.toHaveProperty('commissionMinor');
      expect(view).not.toHaveProperty('merchantNetMinor');
    }
  });

  it('returns nulls, not zeros, when there are no samples or sales', async () => {
    const { service } = buildService({});
    const view = await service.getDailySummary(ACCOUNT, MERCHANT, {});
    expect(view.dataStatus).toBe('OK');
    expect(view.grossMerchandiseMinor).toBe('0');
    expect(view.averageBasketMinor).toBeNull();
    expect(view.averageActualPreparationMinutes).toBeNull();
    expect(view.onTimePreparationRateBps).toBeNull();
    expect(view.preparationSampleCount).toBe(0);
    expect(view.cancellationReasons).toEqual([]);
  });

  it('aggregates counts, sales, preparation and cancellation reasons', async () => {
    const { service } = buildService({
      rows: {
        'AS created_count': [
          {
            created_count: 10,
            completed: 5,
            in_progress: 2,
            cancelled: 2,
            failed: 1,
          },
        ],
        'AS snapshot_count': [
          { completed_count: 4, snapshot_count: 4, gms: 10_001n },
        ],
        'AS reason_code': [
          { reason_code: 'TOO_BUSY', cnt: 1 },
          { reason_code: 'UNSET', cnt: 2 },
          { reason_code: 'PRODUCT_UNAVAILABLE', cnt: 3 },
        ],
        'AS sample_count': [
          {
            sample_count: 3,
            total_minutes: 50n,
            estimate_sample_count: 2,
            on_time_count: 1,
            late_count: 1,
          },
        ],
      },
    });
    const view = await service.getDailySummary(ACCOUNT, MERCHANT, {});
    expect(view.ordersCreatedCount).toBe(10);
    expect(view.breakdown).toEqual({
      completed: 5,
      inProgress: 2,
      cancelled: 2,
      failed: 1,
    });
    expect(view.completedOrderCount).toBe(4);
    expect(view.grossMerchandiseMinor).toBe('10001');
    expect(view.averageBasketMinor).toBe('2500');
    expect(view.averageActualPreparationMinutes).toBe(16);
    expect(view.preparationSampleCount).toBe(3);
    expect(view.onTimeLateSampleCount).toBe(2);
    expect(view.onTimePreparationRateBps).toBe(5000);
    expect(view.latePreparationCount).toBe(1);
    expect(view.cancelledOrderCount).toBe(6);
    expect(view.cancellationReasons).toEqual([
      {
        reasonCode: 'PRODUCT_UNAVAILABLE',
        label: 'Indisponibilité produit',
        count: 3,
      },
      { reasonCode: 'TOO_BUSY', label: 'Trop occupé', count: 1 },
      { reasonCode: 'UNSET', label: 'Non renseignée', count: 2 },
    ]);
  });

  it('withholds money when a completed sale lacks its snapshot', async () => {
    const { service } = buildService({
      rows: {
        'AS snapshot_count': [
          { completed_count: 3, snapshot_count: 2, gms: 900n },
        ],
      },
    });
    const view = await service.getDailySummary(ACCOUNT, MERCHANT, {});
    expect(view.dataStatus).toBe('MISSING_FINANCIAL_SNAPSHOT');
    expect(view.completedOrderCount).toBe(3);
    expect(view.grossMerchandiseMinor).toBeNull();
    expect(view.averageBasketMinor).toBeNull();
  });
});
