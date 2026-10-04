/**
 * Repository-level regression for weekly and exceptional interval replacement
 * against a real PostgreSQL database through the Prisma ORM 8 runtime.
 *
 * Runs only against the disposable `speedygo_parity_fx` database created by
 * the isolated fixture environment (127.0.0.1:5433), whose seed provides the
 * fixture merchants and branches used below. The runner verifies the
 * database's disposable marker and exports FX_ISOLATED_RUN_ID; any other
 * target is refused before a connection is opened.
 * Config: test/jest-isolated-db.json (never the e2e harness).
 */
import { PrismaService } from '../../../infrastructure/database/database.module';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import { pgNow } from '../../../infrastructure/database/pg-values';
import { OpeningHoursService } from '../application/opening-hours.service';
import type { MerchantAccessService } from '../application/merchant-access.service';
import type { NormalizedExceptionInterval } from '../domain/opening-hours-exception.policy';
import type { NormalizedOpeningInterval } from '../domain/opening-hours.policy';
import { BranchAvailabilityRepository } from './branch-availability.repository';
import { OpeningHoursExceptionRepository } from './opening-hours-exception.repository';
import { OpeningHoursRepository } from './opening-hours.repository';

function assertIsolatedTarget(): void {
  const raw = process.env['DATABASE_URL'];
  if (!raw) {
    throw new Error('refused: DATABASE_URL is not set');
  }
  const url = new URL(raw);
  const host = url.hostname;
  if (
    url.pathname !== '/speedygo_parity_fx' ||
    url.port !== '5433' ||
    (host !== '127.0.0.1' && host !== 'localhost')
  ) {
    throw new Error(
      'refused: target is not speedygo_parity_fx on 127.0.0.1:5433',
    );
  }
  if (!/^fxenv_\d{8}T\d{6}Z$/.test(process.env['FX_ISOLATED_RUN_ID'] ?? '')) {
    throw new Error(
      'refused: FX_ISOLATED_RUN_ID missing (runner did not verify the marker)',
    );
  }
}

assertIsolatedTarget();

const NS = '0d00f0f0-fa00-7000-8000-';
const FIXTURE_MERCHANT = NS + '000000001001';
const FIXTURE_BRANCH = NS + '000000002001';
const FIXTURE_OWNER = NS + '000000000101';
const TARGET_MERCHANT = NS + '000000001002';
const TARGET_BRANCH = NS + '000000002002';
const TARGET_OWNER = NS + '000000000104';

const EXCEPTION_DATE = '2027-04-20';
const OTHER_EXCEPTION_DATE = '2027-04-21';
const MONDAY = '2027-03-15';
const TUESDAY = '2027-03-16';
const WEDNESDAY = '2027-03-17';

const H = 60;

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

type WeeklyRow = {
  id: string;
  scheduleId: string;
  dayOfWeek: number;
  opensMinute: number;
  closesMinute: number;
  closesNextDay: boolean;
  sortOrder: number;
};

type ExceptionIntervalRow = {
  id: string;
  exceptionId: string;
  opensMinute: number;
  closesMinute: number;
  closesNextDay: boolean;
  sortOrder: number;
};

function weeklyKey(
  i: Omit<NormalizedOpeningInterval, 'dayOfWeek'> & { dayOfWeek: number },
): string {
  return [
    i.dayOfWeek,
    i.opensMinute,
    i.closesMinute,
    i.closesNextDay,
    i.sortOrder,
  ].join('|');
}

function exceptionKey(i: NormalizedExceptionInterval): string {
  return [i.opensMinute, i.closesMinute, i.closesNextDay, i.sortOrder].join(
    '|',
  );
}

const FULL_WEEK: NormalizedOpeningInterval[] = [1, 2, 3, 4, 5, 6].flatMap(
  (day) => [weekly(day, 9 * H, 13 * H, 0), weekly(day, 15 * H, 19 * H, 1)],
);

/** Africa/Algiers is UTC+01:00 all year (no DST). */
function algiers(localDateTime: string): Date {
  return new Date(`${localDateTime}:00+01:00`);
}

describe('opening-hours interval replacement (isolated PostgreSQL)', () => {
  const prisma = new PrismaService();
  const weeklyRepo = new OpeningHoursRepository(prisma);
  const exceptionRepo = new OpeningHoursExceptionRepository(prisma);
  const access = {
    requireCapability: () => Promise.resolve(undefined),
  } as unknown as MerchantAccessService;
  const service = new OpeningHoursService(
    weeklyRepo,
    new BranchAvailabilityRepository(prisma),
    access,
    exceptionRepo,
  );
  const orm = () => prisma.getDb().orm.public;

  async function weeklyRows(scheduleId: string): Promise<WeeklyRow[]> {
    const rows = await orm()
      .MerchantBranchOpeningInterval.where({ scheduleId })
      .all();
    return rows
      .map((row) => ({
        id: row.id,
        scheduleId: row.scheduleId,
        dayOfWeek: row.dayOfWeek,
        opensMinute: row.opensMinute,
        closesMinute: row.closesMinute,
        closesNextDay: row.closesNextDay,
        sortOrder: row.sortOrder,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async function exceptionRows(
    exceptionId: string,
  ): Promise<ExceptionIntervalRow[]> {
    const rows = await orm()
      .MerchantBranchHoursExceptionInterval.where({ exceptionId })
      .all();
    return rows
      .map((row) => ({
        id: row.id,
        exceptionId: row.exceptionId,
        opensMinute: row.opensMinute,
        closesMinute: row.closesMinute,
        closesNextDay: row.closesNextDay,
        sortOrder: row.sortOrder,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async function ensureSchedule(branchId: string, accountId: string) {
    const existing = await weeklyRepo.findScheduleByBranchId(branchId);
    if (existing) {
      return existing;
    }
    return weeklyRepo.createSchedule({
      branchId,
      updatedByAccountId: accountId,
      intervals: [1, 2, 3, 4, 5, 6, 7].map((day) => weekly(day, 8 * H, 12 * H)),
    });
  }

  async function insertWeeklyRows(
    scheduleId: string,
    intervals: NormalizedOpeningInterval[],
  ) {
    for (const i of intervals) {
      await orm().MerchantBranchOpeningInterval.create({
        id: createUuidV7(),
        scheduleId,
        dayOfWeek: i.dayOfWeek,
        opensMinute: i.opensMinute,
        closesMinute: i.closesMinute,
        closesNextDay: i.closesNextDay,
        sortOrder: i.sortOrder,
        createdAt: pgNow(),
      });
    }
  }

  async function replaceWeekly(
    branchId: string,
    accountId: string,
    intervals: NormalizedOpeningInterval[],
  ) {
    const current = await weeklyRepo.findScheduleByBranchId(branchId);
    const record = await weeklyRepo.replaceSchedule({
      scheduleId: current!.id,
      branchId,
      expectedVersion: current!.version,
      updatedByAccountId: accountId,
      intervals,
    });
    expect(record?.version).toBe(current!.version + 1);
    return record!;
  }

  async function resetException(
    branchId: string,
    accountId: string,
    localDate: string,
    intervals: NormalizedExceptionInterval[],
  ) {
    const existing = await exceptionRepo.findByDate(branchId, localDate);
    if (existing) {
      expect(
        await exceptionRepo.delete({
          branchId,
          localDate,
          expectedVersion: existing.version,
        }),
      ).toBe('deleted');
    }
    const created = await exceptionRepo.create({
      branchId,
      updatedByAccountId: accountId,
      exception: {
        localDate,
        closed: false,
        intervals,
        label: 'Horaires spéciaux',
        customerMessage: null,
      },
    });
    expect(created.status).toBe('ok');
    return created.status === 'ok' ? created.record : null!;
  }

  async function replaceException(
    branchId: string,
    accountId: string,
    localDate: string,
    expectedVersion: number,
    closed: boolean,
    intervals: NormalizedExceptionInterval[],
  ) {
    return exceptionRepo.replace({
      branchId,
      expectedVersion,
      updatedByAccountId: accountId,
      exception: {
        localDate,
        closed,
        intervals,
        label: 'Horaires réduits',
        customerMessage: null,
      },
    });
  }

  beforeAll(async () => {
    const merchant = await orm()
      .Merchant.where({ id: FIXTURE_MERCHANT })
      .first();
    if (merchant?.publicReference !== 'sgm_parityfx_01') {
      throw new Error(
        'refused: fixture merchant not found; not the seeded isolated database',
      );
    }
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('weekly schedule', () => {
    it('replaces a duplicated schedule with exactly the submitted rows and never grows', async () => {
      const fixtureSchedule =
        await weeklyRepo.findScheduleByBranchId(FIXTURE_BRANCH);
      const fixtureRowsBefore = await weeklyRows(fixtureSchedule!.id);
      expect(fixtureRowsBefore.length).toBeGreaterThanOrEqual(7);

      const schedule = await ensureSchedule(TARGET_BRANCH, TARGET_OWNER);
      await replaceWeekly(
        TARGET_BRANCH,
        TARGET_OWNER,
        [1, 2, 3, 4, 5, 6, 7].map((day) => weekly(day, 8 * H, 12 * H)),
      );
      await insertWeeklyRows(schedule.id, [
        weekly(1, 8 * H, 12 * H),
        weekly(2, 8 * H, 12 * H),
        weekly(2, 8 * H, 12 * H),
        weekly(3, 8 * H, 12 * H),
      ]);
      const seeded = await weeklyRows(schedule.id);
      expect(seeded.length).toBeGreaterThanOrEqual(11);

      const expected = FULL_WEEK.map(weeklyKey).sort();
      for (let save = 1; save <= 3; save += 1) {
        await replaceWeekly(TARGET_BRANCH, TARGET_OWNER, FULL_WEEK);
        const rows = await weeklyRows(schedule.id);
        expect(rows.map(weeklyKey).sort()).toEqual(expected);
        expect(rows).toHaveLength(FULL_WEEK.length);
        expect(
          rows.some((row) => seeded.some((old) => old.id === row.id)),
        ).toBe(false);
      }

      const withoutWednesday = FULL_WEEK.filter((i) => i.dayOfWeek !== 3);
      await replaceWeekly(TARGET_BRANCH, TARGET_OWNER, withoutWednesday);
      const toggled = await weeklyRows(schedule.id);
      expect(toggled.map(weeklyKey).sort()).toEqual(
        withoutWednesday.map(weeklyKey).sort(),
      );
      expect(toggled.some((row) => row.dayOfWeek === 3)).toBe(false);

      await replaceWeekly(TARGET_BRANCH, TARGET_OWNER, FULL_WEEK);
      expect((await weeklyRows(schedule.id)).map(weeklyKey).sort()).toEqual(
        expected,
      );

      const view = await service.getForMerchant(
        TARGET_OWNER,
        TARGET_MERCHANT,
        TARGET_BRANCH,
      );
      const readBack = view.days.flatMap((day) =>
        day.intervals.map((i) => `${day.dayOfWeek}|${i.opens}|${i.closes}`),
      );
      expect(readBack).toHaveLength(FULL_WEEK.length);
      expect(new Set(readBack).size).toBe(readBack.length);
      expect(view.days.find((day) => day.dayOfWeek === 3)?.intervals).toEqual([
        {
          opens: '09:00',
          closes: '13:00',
          opensMinute: 540,
          closesMinute: 780,
          closesNextDay: false,
        },
        {
          opens: '15:00',
          closes: '19:00',
          opensMinute: 900,
          closesMinute: 1140,
          closesNextDay: false,
        },
      ]);

      const fixtureAfter =
        await weeklyRepo.findScheduleByBranchId(FIXTURE_BRANCH);
      expect(fixtureAfter?.version).toBe(fixtureSchedule!.version);
      expect(fixtureAfter?.updatedAt).toBe(fixtureSchedule!.updatedAt);
      expect(await weeklyRows(fixtureSchedule!.id)).toEqual(fixtureRowsBefore);
    });

    it('stores an all-closed week as an empty schedule and rejects a stale version', async () => {
      const schedule = await ensureSchedule(TARGET_BRANCH, TARGET_OWNER);
      await replaceWeekly(TARGET_BRANCH, TARGET_OWNER, []);
      expect(await weeklyRows(schedule.id)).toEqual([]);
      const empty = await weeklyRepo.findScheduleByBranchId(TARGET_BRANCH);
      expect(empty?.intervals).toEqual([]);

      await replaceWeekly(TARGET_BRANCH, TARGET_OWNER, FULL_WEEK);
      const current = await weeklyRepo.findScheduleByBranchId(TARGET_BRANCH);
      const rowsBefore = await weeklyRows(schedule.id);
      const stale = await weeklyRepo.replaceSchedule({
        scheduleId: schedule.id,
        branchId: TARGET_BRANCH,
        expectedVersion: current!.version - 1,
        updatedByAccountId: TARGET_OWNER,
        intervals: [weekly(1, 10 * H, 11 * H)],
      });
      expect(stale).toBeNull();
      expect(await weeklyRows(schedule.id)).toEqual(rowsBefore);
      expect(
        (await weeklyRepo.findScheduleByBranchId(TARGET_BRANCH))?.version,
      ).toBe(current!.version);
    });
  });

  describe('exceptional hours', () => {
    it('replaces three intervals with one, repeatedly, without touching other exceptions', async () => {
      await ensureSchedule(TARGET_BRANCH, TARGET_OWNER);
      await ensureSchedule(FIXTURE_BRANCH, FIXTURE_OWNER);
      const target = await resetException(
        TARGET_BRANCH,
        TARGET_OWNER,
        EXCEPTION_DATE,
        [
          sameDay(8 * H, 10 * H, 0),
          sameDay(11 * H, 13 * H, 1),
          sameDay(15 * H, 17 * H, 2),
        ],
      );
      const otherDate = await resetException(
        TARGET_BRANCH,
        TARGET_OWNER,
        OTHER_EXCEPTION_DATE,
        [sameDay(9 * H, 12 * H, 0), sameDay(14 * H, 0, 1)],
      );
      const otherBranch = await resetException(
        FIXTURE_BRANCH,
        FIXTURE_OWNER,
        EXCEPTION_DATE,
        [sameDay(7 * H, 11 * H, 0)],
      );
      expect(await exceptionRows(target.id)).toHaveLength(3);
      const otherDateRows = await exceptionRows(otherDate.id);
      const otherBranchRows = await exceptionRows(otherBranch.id);

      const first = await replaceException(
        TARGET_BRANCH,
        TARGET_OWNER,
        EXCEPTION_DATE,
        1,
        false,
        [sameDay(10 * H, 20 * H, 0)],
      );
      expect(first.status).toBe('ok');
      expect((await exceptionRows(target.id)).map(exceptionKey)).toEqual([
        '600|1200|false|0',
      ]);

      let version = 2;
      for (const opens of [9 * H, 11 * H, 10 * H]) {
        const outcome = await replaceException(
          TARGET_BRANCH,
          TARGET_OWNER,
          EXCEPTION_DATE,
          version,
          false,
          [sameDay(opens, 20 * H, 0)],
        );
        expect(outcome.status).toBe('ok');
        expect(outcome.status === 'ok' && outcome.record.version).toBe(
          version + 1,
        );
        const rows = await exceptionRows(target.id);
        expect(rows).toHaveLength(1);
        expect(rows.map(exceptionKey)).toEqual([
          exceptionKey(sameDay(opens, 20 * H, 0)),
        ]);
        version += 1;
      }

      const closed = await replaceException(
        TARGET_BRANCH,
        TARGET_OWNER,
        EXCEPTION_DATE,
        version,
        true,
        [],
      );
      expect(closed.status === 'ok' && closed.record.closed).toBe(true);
      expect(await exceptionRows(target.id)).toEqual([]);
      version += 1;

      const reopened = await replaceException(
        TARGET_BRANCH,
        TARGET_OWNER,
        EXCEPTION_DATE,
        version,
        false,
        [sameDay(10 * H, 12 * H, 0), sameDay(14 * H, 16 * H, 1)],
      );
      expect(reopened.status === 'ok' && reopened.record.intervals).toEqual([
        sameDay(10 * H, 12 * H, 0),
        sameDay(14 * H, 16 * H, 1),
      ]);
      expect(await exceptionRows(target.id)).toHaveLength(2);
      version += 1;

      const rowsBeforeStale = await exceptionRows(target.id);
      const stale = await replaceException(
        TARGET_BRANCH,
        TARGET_OWNER,
        EXCEPTION_DATE,
        version - 1,
        false,
        [sameDay(6 * H, 7 * H, 0)],
      );
      expect(stale).toEqual({ status: 'conflict' });
      expect(await exceptionRows(target.id)).toEqual(rowsBeforeStale);
      expect(
        (await exceptionRepo.findByDate(TARGET_BRANCH, EXCEPTION_DATE))
          ?.version,
      ).toBe(version);

      expect(await exceptionRows(otherDate.id)).toEqual(otherDateRows);
      expect(await exceptionRows(otherBranch.id)).toEqual(otherBranchRows);
      expect(
        (await exceptionRepo.findByDate(TARGET_BRANCH, OTHER_EXCEPTION_DATE))
          ?.version,
      ).toBe(1);
      expect(
        (await exceptionRepo.findByDate(FIXTURE_BRANCH, EXCEPTION_DATE))
          ?.version,
      ).toBe(1);
    });

    it('deleteAndCount() runs inside the surrounding transaction', async () => {
      const exception = await exceptionRepo.findByDate(
        TARGET_BRANCH,
        OTHER_EXCEPTION_DATE,
      );
      const before = await exceptionRows(exception!.id);
      expect(before).toHaveLength(2);
      let deleted = -1;
      await expect(
        prisma.getDb().transaction(async (tx) => {
          deleted =
            await tx.orm.public.MerchantBranchHoursExceptionInterval.where({
              exceptionId: exception!.id,
            }).deleteAndCount();
          throw new Error('rollback probe');
        }),
      ).rejects.toThrow('rollback probe');
      expect(deleted).toBe(2);
      expect(await exceptionRows(exception!.id)).toEqual(before);
    });
  });

  describe('effective evaluation after replacement (Africa/Algiers)', () => {
    it('uses only the final weekly and exception intervals', async () => {
      const schedule = await ensureSchedule(TARGET_BRANCH, TARGET_OWNER);
      const staleWeek = [
        weekly(1, 8 * H, 12 * H, 0),
        weekly(2, 8 * H, 23 * H, 0),
        weekly(4, 8 * H, 23 * H, 0),
      ];
      await replaceWeekly(TARGET_BRANCH, TARGET_OWNER, staleWeek);
      await insertWeeklyRows(schedule.id, staleWeek);
      const finalWeek = [
        weekly(1, 14 * H, 18 * H, 0),
        weekly(1, 22 * H, 2 * H, 1),
        weekly(2, 10 * H, 12 * H, 0),
      ];
      await replaceWeekly(TARGET_BRANCH, TARGET_OWNER, finalWeek);
      expect((await weeklyRows(schedule.id)).map(weeklyKey).sort()).toEqual(
        finalWeek.map(weeklyKey).sort(),
      );

      const wednesday = await resetException(
        TARGET_BRANCH,
        TARGET_OWNER,
        WEDNESDAY,
        [
          sameDay(8 * H, 10 * H, 0),
          sameDay(11 * H, 13 * H, 1),
          sameDay(15 * H, 17 * H, 2),
        ],
      );
      const replaced = await replaceException(
        TARGET_BRANCH,
        TARGET_OWNER,
        WEDNESDAY,
        wednesday.version,
        false,
        [sameDay(12 * H, 14 * H, 0)],
      );
      expect(replaced.status).toBe('ok');
      expect(await exceptionRows(wednesday.id)).toHaveLength(1);

      const cases: Array<[string, boolean, string | null, string | null]> = [
        [`${MONDAY}T09:00`, false, null, '2027-03-15T13:00:00.000Z'],
        [`${MONDAY}T13:59`, false, null, '2027-03-15T13:00:00.000Z'],
        [`${MONDAY}T14:00`, true, '2027-03-15T17:00:00.000Z', null],
        [`${MONDAY}T17:59`, true, '2027-03-15T17:00:00.000Z', null],
        [`${MONDAY}T18:00`, false, null, '2027-03-15T21:00:00.000Z'],
        [`${MONDAY}T23:30`, true, '2027-03-16T01:00:00.000Z', null],
        [`${TUESDAY}T01:59`, true, '2027-03-16T01:00:00.000Z', null],
        [`${TUESDAY}T02:00`, false, null, '2027-03-16T09:00:00.000Z'],
        [`${TUESDAY}T09:00`, false, null, '2027-03-16T09:00:00.000Z'],
        [`${TUESDAY}T12:00`, false, null, '2027-03-17T11:00:00.000Z'],
        [`${WEDNESDAY}T09:00`, false, null, '2027-03-17T11:00:00.000Z'],
        [`${WEDNESDAY}T12:00`, true, '2027-03-17T13:00:00.000Z', null],
        [`${WEDNESDAY}T14:00`, false, null, '2027-03-22T13:00:00.000Z'],
        [`${WEDNESDAY}T16:00`, false, null, '2027-03-22T13:00:00.000Z'],
        ['2027-03-18T10:00', false, null, '2027-03-22T13:00:00.000Z'],
      ];
      const observed = [];
      for (const [local] of cases) {
        const result = await service.evaluateBranch(
          TARGET_BRANCH,
          algiers(local),
        );
        observed.push({
          local,
          isOpenNow: result.isOpenNow,
          currentClosesAt: result.currentClosesAt?.toISOString() ?? null,
          nextOpenAt: result.nextOpenAt?.toISOString() ?? null,
        });
        expect(result.hoursConfigured).toBe(true);
        expect(result.timezone).toBe('Africa/Algiers');
      }
      expect(observed).toEqual(
        cases.map(([local, open, closesAt, nextOpen]) => ({
          local,
          isOpenNow: open,
          currentClosesAt: closesAt,
          nextOpenAt: nextOpen,
        })),
      );
    });
  });
});
