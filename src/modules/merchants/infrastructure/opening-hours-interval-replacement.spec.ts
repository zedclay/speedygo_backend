import type { PrismaService } from '../../../infrastructure/database/database.module';
import type { NormalizedExceptionInterval } from '../domain/opening-hours-exception.policy';
import type { NormalizedOpeningInterval } from '../domain/opening-hours.policy';
import { OpeningHoursExceptionRepository } from './opening-hours-exception.repository';
import { OpeningHoursRepository } from './opening-hours.repository';

/**
 * In-memory stand-in for the Prisma ORM 8 collection API, limited to the
 * terminals the opening-hours repositories use. Terminal semantics follow the
 * installed @prisma/orm-family-sql 8.0.0-rc.8: `delete()` removes only the
 * first matching row, `deleteAndCount()` removes every matching row.
 */
type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;

function fieldProxy(): Record<
  string,
  { in: (v: unknown[]) => Predicate; gte: (v: unknown) => Predicate }
> {
  return new Proxy(
    {},
    {
      get: (_target, field: string) => ({
        in: (values: unknown[]) => (row: Row) => values.includes(row[field]),
        gte: (value: unknown) => (row: Row) =>
          String(row[field]) >= String(value),
      }),
    },
  );
}

class FakeCollection {
  constructor(
    private readonly rows: Row[],
    private readonly filters: Predicate[] = [],
  ) {}

  where(input: Row | ((row: unknown) => Predicate)): FakeCollection {
    const predicate: Predicate =
      typeof input === 'function'
        ? input(fieldProxy())
        : (row) =>
            Object.entries(input).every(
              ([key, value]) => value === undefined || row[key] === value,
            );
    return new FakeCollection(this.rows, [...this.filters, predicate]);
  }

  private matches(): Row[] {
    return this.rows.filter((row) => this.filters.every((f) => f(row)));
  }

  first(): Promise<Row | null> {
    const row = this.matches()[0];
    return Promise.resolve(row ? { ...row } : null);
  }

  all(): Promise<Row[]> {
    return Promise.resolve(this.matches().map((row) => ({ ...row })));
  }

  create(values: Row): Promise<Row> {
    this.rows.push({ ...values });
    return Promise.resolve({ ...values });
  }

  update(patch: Row): Promise<Row | null> {
    const hits = this.matches();
    for (const row of hits) {
      Object.assign(row, patch);
    }
    return Promise.resolve(hits[0] ? { ...hits[0] } : null);
  }

  delete(): Promise<Row | null> {
    const row = this.matches()[0];
    if (!row) {
      return Promise.resolve(null);
    }
    this.rows.splice(this.rows.indexOf(row), 1);
    return Promise.resolve({ ...row });
  }

  deleteAndCount(): Promise<number> {
    if (this.filters.length === 0) {
      return Promise.reject(
        new Error('deleteAndCount() requires a where filter'),
      );
    }
    const hits = this.matches();
    for (const row of hits) {
      this.rows.splice(this.rows.indexOf(row), 1);
    }
    return Promise.resolve(hits.length);
  }
}

type Tables = {
  MerchantBranchOpeningSchedule: Row[];
  MerchantBranchOpeningInterval: Row[];
  MerchantBranchHoursException: Row[];
  MerchantBranchHoursExceptionInterval: Row[];
};

function fakeDb(tables: Tables) {
  const db = {
    orm: {
      public: new Proxy(
        {},
        {
          get: (_target, model: keyof Tables) =>
            new FakeCollection(tables[model]),
        },
      ),
    },
    transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(db),
  };
  return db;
}

const BRANCH = '0d00f0f0-fa00-7000-8000-00000000a001';
const OTHER_BRANCH = '0d00f0f0-fa00-7000-8000-00000000a002';
const SCHEDULE = '0d00f0f0-fa00-7000-8000-00000000b001';
const OTHER_SCHEDULE = '0d00f0f0-fa00-7000-8000-00000000b002';
const ACCOUNT = '0d00f0f0-fa00-7000-8000-00000000c001';
const EXCEPTION = '0d00f0f0-fa00-7000-8000-00000000d001';
const OTHER_DATE_EXCEPTION = '0d00f0f0-fa00-7000-8000-00000000d002';
const OTHER_BRANCH_EXCEPTION = '0d00f0f0-fa00-7000-8000-00000000d003';
const DATE = '2027-04-20';
const OTHER_DATE = '2027-04-21';
const TS = '2027-01-01T00:00:00.000Z';

let seq = 0;
function weeklyRow(
  scheduleId: string,
  day: number,
  opens: number,
  closes: number,
  sortOrder = 0,
): Row {
  seq += 1;
  return {
    id: `wk-${seq}`,
    scheduleId,
    dayOfWeek: day,
    opensMinute: opens,
    closesMinute: closes,
    closesNextDay: closes <= opens,
    sortOrder,
    createdAt: TS,
  };
}

function exceptionIntervalRow(
  exceptionId: string,
  opens: number,
  closes: number,
  sortOrder: number,
): Row {
  seq += 1;
  return {
    id: `ex-${seq}`,
    exceptionId,
    opensMinute: opens,
    closesMinute: closes,
    closesNextDay: closes === 0,
    sortOrder,
    createdAt: TS,
  };
}

function scheduleRow(id: string, branchId: string, version: number): Row {
  return {
    id,
    branchId,
    version,
    updatedByAccountId: ACCOUNT,
    createdAt: TS,
    updatedAt: TS,
  };
}

function exceptionRow(
  id: string,
  branchId: string,
  localDate: string,
  version: number,
  closed = false,
): Row {
  return {
    id,
    branchId,
    localDate,
    closed,
    label: 'Horaires spéciaux',
    customerMessage: null,
    version,
    updatedByAccountId: ACCOUNT,
    createdAt: TS,
    updatedAt: TS,
  };
}

function weekly(
  day: number,
  opens: number,
  closes: number,
  sortOrder = 0,
): NormalizedOpeningInterval {
  return {
    dayOfWeek: day as NormalizedOpeningInterval['dayOfWeek'],
    opensMinute: opens,
    closesMinute: closes,
    closesNextDay: closes <= opens,
    sortOrder,
  };
}

function sameDay(
  opens: number,
  closes: number,
  sortOrder: number,
): NormalizedExceptionInterval {
  return {
    opensMinute: opens,
    closesMinute: closes,
    closesNextDay: closes === 0,
    sortOrder,
  };
}

function weeklyTuples(rows: Row[], scheduleId: string): string[] {
  return rows
    .filter((row) => row.scheduleId === scheduleId)
    .map((row) =>
      [
        row.dayOfWeek,
        row.opensMinute,
        row.closesMinute,
        row.closesNextDay,
        row.sortOrder,
      ]
        .map(String)
        .join('|'),
    )
    .sort();
}

function submittedTuples(intervals: NormalizedOpeningInterval[]): string[] {
  return intervals
    .map(
      (i) =>
        `${i.dayOfWeek}|${i.opensMinute}|${i.closesMinute}|${i.closesNextDay}|${i.sortOrder}`,
    )
    .sort();
}

function exceptionTuples(rows: Row[], exceptionId: string): string[] {
  return rows
    .filter((row) => row.exceptionId === exceptionId)
    .map((row) =>
      [row.opensMinute, row.closesMinute, row.closesNextDay, row.sortOrder]
        .map(String)
        .join('|'),
    )
    .sort();
}

const FULL_WEEK: NormalizedOpeningInterval[] = [1, 2, 3, 4, 5, 6].flatMap(
  (day) => [weekly(day, 9 * 60, 13 * 60, 0), weekly(day, 15 * 60, 19 * 60, 1)],
);

describe('opening-hours interval replacement (repository)', () => {
  let tables: Tables;
  let weeklyRepo: OpeningHoursRepository;
  let exceptionRepo: OpeningHoursExceptionRepository;

  beforeEach(() => {
    seq = 0;
    tables = {
      MerchantBranchOpeningSchedule: [
        scheduleRow(SCHEDULE, BRANCH, 1),
        scheduleRow(OTHER_SCHEDULE, OTHER_BRANCH, 4),
      ],
      MerchantBranchOpeningInterval: [
        // Target schedule: seven days plus duplicated rows left by earlier saves.
        ...[1, 2, 3, 4, 5, 6, 7].map((day) =>
          weeklyRow(SCHEDULE, day, 8 * 60, 12 * 60),
        ),
        weeklyRow(SCHEDULE, 1, 8 * 60, 12 * 60),
        weeklyRow(SCHEDULE, 2, 8 * 60, 12 * 60),
        weeklyRow(SCHEDULE, 2, 8 * 60, 12 * 60),
        ...[1, 2, 3].map((day) =>
          weeklyRow(OTHER_SCHEDULE, day, 10 * 60, 22 * 60),
        ),
      ],
      MerchantBranchHoursException: [
        exceptionRow(EXCEPTION, BRANCH, DATE, 1),
        exceptionRow(OTHER_DATE_EXCEPTION, BRANCH, OTHER_DATE, 2),
        exceptionRow(OTHER_BRANCH_EXCEPTION, OTHER_BRANCH, DATE, 1),
      ],
      MerchantBranchHoursExceptionInterval: [
        exceptionIntervalRow(EXCEPTION, 8 * 60, 10 * 60, 0),
        exceptionIntervalRow(EXCEPTION, 11 * 60, 13 * 60, 1),
        exceptionIntervalRow(EXCEPTION, 15 * 60, 17 * 60, 2),
        exceptionIntervalRow(OTHER_DATE_EXCEPTION, 9 * 60, 12 * 60, 0),
        exceptionIntervalRow(OTHER_DATE_EXCEPTION, 14 * 60, 0, 1),
        exceptionIntervalRow(OTHER_BRANCH_EXCEPTION, 7 * 60, 11 * 60, 0),
      ],
    };
    const prisma = { getDb: () => fakeDb(tables) } as unknown as PrismaService;
    weeklyRepo = new OpeningHoursRepository(prisma);
    exceptionRepo = new OpeningHoursExceptionRepository(prisma);
  });

  describe('weekly schedule', () => {
    async function replace(
      expectedVersion: number,
      intervals: NormalizedOpeningInterval[],
    ) {
      return weeklyRepo.replaceSchedule({
        scheduleId: SCHEDULE,
        branchId: BRANCH,
        expectedVersion,
        updatedByAccountId: ACCOUNT,
        intervals,
      });
    }

    it('removes every old interval, including duplicates, before inserting the replacement', async () => {
      expect(
        weeklyTuples(tables.MerchantBranchOpeningInterval, SCHEDULE),
      ).toHaveLength(10);
      const otherBefore = tables.MerchantBranchOpeningInterval.filter(
        (r) => r.scheduleId === OTHER_SCHEDULE,
      );

      const record = await replace(1, FULL_WEEK);

      expect(
        weeklyTuples(tables.MerchantBranchOpeningInterval, SCHEDULE),
      ).toEqual(submittedTuples(FULL_WEEK));
      expect(record?.version).toBe(2);
      expect(record?.intervals).toHaveLength(FULL_WEEK.length);
      expect(
        tables.MerchantBranchOpeningInterval.filter(
          (r) => r.scheduleId === OTHER_SCHEDULE,
        ),
      ).toEqual(otherBefore);
    });

    it('keeps the row count stable across repeated saves and a weekday toggle', async () => {
      await replace(1, FULL_WEEK);
      await replace(2, FULL_WEEK);
      await replace(3, FULL_WEEK);
      expect(
        weeklyTuples(tables.MerchantBranchOpeningInterval, SCHEDULE),
      ).toEqual(submittedTuples(FULL_WEEK));

      const withoutWednesday = FULL_WEEK.filter((i) => i.dayOfWeek !== 3);
      await replace(4, withoutWednesday);
      expect(
        weeklyTuples(tables.MerchantBranchOpeningInterval, SCHEDULE),
      ).toEqual(submittedTuples(withoutWednesday));

      const restored = await replace(5, FULL_WEEK);
      expect(
        weeklyTuples(tables.MerchantBranchOpeningInterval, SCHEDULE),
      ).toEqual(submittedTuples(FULL_WEEK));
      expect(restored?.version).toBe(6);
      const keys = restored!.intervals.map(
        (i) => `${i.dayOfWeek}|${i.opensMinute}|${i.closesMinute}`,
      );
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('stores an all-closed week as an empty schedule', async () => {
      const record = await replace(1, []);
      expect(record?.intervals).toEqual([]);
      expect(
        weeklyTuples(tables.MerchantBranchOpeningInterval, SCHEDULE),
      ).toEqual([]);
      expect(
        tables.MerchantBranchOpeningSchedule.find((r) => r.id === SCHEDULE)
          ?.version,
      ).toBe(2);
      expect(
        weeklyTuples(tables.MerchantBranchOpeningInterval, OTHER_SCHEDULE),
      ).toHaveLength(3);
    });

    it('leaves intervals untouched on a stale version', async () => {
      const before = tables.MerchantBranchOpeningInterval.map((row) => ({
        ...row,
      }));
      expect(await replace(7, FULL_WEEK)).toBeNull();
      expect(tables.MerchantBranchOpeningInterval).toEqual(before);
    });
  });

  describe('exceptional hours', () => {
    async function replace(
      expectedVersion: number,
      closed: boolean,
      intervals: NormalizedExceptionInterval[],
    ) {
      return exceptionRepo.replace({
        branchId: BRANCH,
        expectedVersion,
        updatedByAccountId: ACCOUNT,
        exception: {
          localDate: DATE,
          closed,
          intervals,
          label: 'Horaires réduits',
          customerMessage: null,
        },
      });
    }

    it('replaces three intervals with one and never grows on repeated saves', async () => {
      const othersBefore = tables.MerchantBranchHoursExceptionInterval.filter(
        (r) => r.exceptionId !== EXCEPTION,
      );

      const first = await replace(1, false, [sameDay(10 * 60, 20 * 60, 0)]);
      expect(first.status).toBe('ok');
      expect(
        exceptionTuples(tables.MerchantBranchHoursExceptionInterval, EXCEPTION),
      ).toEqual(['600|1200|false|0']);

      for (const [version, opens] of [
        [2, 9 * 60],
        [3, 11 * 60],
        [4, 10 * 60],
      ] as const) {
        const outcome = await replace(version, false, [
          sameDay(opens, 20 * 60, 0),
        ]);
        expect(outcome.status).toBe('ok');
        expect(
          exceptionTuples(
            tables.MerchantBranchHoursExceptionInterval,
            EXCEPTION,
          ),
        ).toHaveLength(1);
      }
      const final = await exceptionRepo.findByDate(BRANCH, DATE);
      expect(final?.version).toBe(5);
      expect(final?.intervals).toEqual([sameDay(10 * 60, 20 * 60, 0)]);
      expect(
        tables.MerchantBranchHoursExceptionInterval.filter(
          (r) => r.exceptionId !== EXCEPTION,
        ),
      ).toEqual(othersBefore);
    });

    it('stores a closed exception without intervals', async () => {
      const outcome = await replace(1, true, []);
      expect(outcome.status).toBe('ok');
      expect(outcome.status === 'ok' && outcome.record.closed).toBe(true);
      expect(
        exceptionTuples(tables.MerchantBranchHoursExceptionInterval, EXCEPTION),
      ).toEqual([]);
      expect(
        exceptionTuples(
          tables.MerchantBranchHoursExceptionInterval,
          OTHER_DATE_EXCEPTION,
        ),
      ).toHaveLength(2);
      expect(
        exceptionTuples(
          tables.MerchantBranchHoursExceptionInterval,
          OTHER_BRANCH_EXCEPTION,
        ),
      ).toHaveLength(1);
    });

    it('returns conflict on a stale version without touching intervals', async () => {
      const before = tables.MerchantBranchHoursExceptionInterval.map((row) => ({
        ...row,
      }));
      expect(await replace(3, false, [sameDay(10 * 60, 12 * 60, 0)])).toEqual({
        status: 'conflict',
      });
      expect(tables.MerchantBranchHoursExceptionInterval).toEqual(before);
      expect(
        tables.MerchantBranchHoursException.find((r) => r.id === EXCEPTION)
          ?.version,
      ).toBe(1);
    });
  });
});
