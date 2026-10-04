import {
  evaluateEffectiveAvailability,
  resolveEffectiveMode,
  effectiveNextOpenAt,
} from './branch-availability.evaluator';
import type { NormalizedOpeningInterval } from './opening-hours.policy';

const mondayNineToSeventeen: NormalizedOpeningInterval[] = [
  {
    dayOfWeek: 1,
    opensMinute: 9 * 60,
    closesMinute: 17 * 60,
    closesNextDay: false,
    sortOrder: 0,
  },
];

describe('branch availability evaluator', () => {
  // Monday 2024-01-15 10:00 Africa/Algiers = 09:00 UTC (CET winter)
  const mondayOpen = new Date('2024-01-15T09:00:00.000Z');
  const mondayClosed = new Date('2024-01-15T18:00:00.000Z');

  it('FOLLOW_SCHEDULE uses weekly hours for acceptingOrders', () => {
    const open = evaluateEffectiveAvailability(
      mondayNineToSeventeen,
      {
        mode: 'FOLLOW_SCHEDULE',
        reasonCode: null,
        customerMessage: null,
        closedUntil: null,
        version: 1,
        updatedAt: mondayOpen.toISOString(),
      },
      mondayOpen,
    );
    expect(open.acceptingOrders).toBe(true);
    expect(open.isOpenNow).toBe(true);
    expect(open.effectiveMode).toBe('FOLLOW_SCHEDULE');

    const closed = evaluateEffectiveAvailability(
      mondayNineToSeventeen,
      null,
      mondayClosed,
    );
    expect(closed.acceptingOrders).toBe(false);
    expect(closed.effectiveMode).toBe('FOLLOW_SCHEDULE');
  });

  it('FORCE_CLOSED blocks and nulls nextOpenAt', () => {
    const ev = evaluateEffectiveAvailability(
      mondayNineToSeventeen,
      {
        mode: 'FORCE_CLOSED',
        reasonCode: 'PEAK_KITCHEN',
        customerMessage: null,
        closedUntil: null,
        version: 2,
        updatedAt: mondayOpen.toISOString(),
      },
      mondayOpen,
    );
    expect(ev.acceptingOrders).toBe(false);
    expect(ev.nextOpenAt).toBeNull();
    expect(ev.closedUntil).toBeNull();
    expect(ev.effectiveMode).toBe('FORCE_CLOSED');
  });

  it('active TEMPORARY_CLOSED blocks; closedUntil distinct from nextOpenAt', () => {
    const until = new Date('2024-01-15T14:00:00.000Z');
    const ev = evaluateEffectiveAvailability(
      mondayNineToSeventeen,
      {
        mode: 'TEMPORARY_CLOSED',
        reasonCode: 'LUNCH_BREAK',
        customerMessage: 'Back soon',
        closedUntil: until,
        version: 1,
        updatedAt: mondayOpen.toISOString(),
      },
      mondayOpen,
    );
    expect(ev.acceptingOrders).toBe(false);
    expect(ev.closedUntil).toBe(until.toISOString());
    expect(ev.nextOpenAt?.toISOString()).toBe(until.toISOString());
  });

  it('expired TEMPORARY_CLOSED resumes schedule without claiming open after hours', () => {
    const until = new Date('2024-01-15T08:00:00.000Z');
    const { effectiveMode, temporaryExpired } = resolveEffectiveMode(
      {
        mode: 'TEMPORARY_CLOSED',
        reasonCode: 'TECHNICAL',
        customerMessage: null,
        closedUntil: until,
        version: 1,
        updatedAt: until.toISOString(),
      },
      mondayClosed,
    );
    expect(effectiveMode).toBe('FOLLOW_SCHEDULE');
    expect(temporaryExpired).toBe(true);

    const ev = evaluateEffectiveAvailability(
      mondayNineToSeventeen,
      {
        mode: 'TEMPORARY_CLOSED',
        reasonCode: 'TECHNICAL',
        customerMessage: null,
        closedUntil: until,
        version: 1,
        updatedAt: until.toISOString(),
      },
      mondayClosed,
    );
    expect(ev.acceptingOrders).toBe(false);
    expect(ev.effectiveMode).toBe('FOLLOW_SCHEDULE');
    expect(ev.temporaryExpired).toBe(true);
    expect(ev.closedUntil).toBeNull();
  });

  it('effectiveNextOpenAt for temporary finds open after closedUntil', () => {
    const until = new Date('2024-01-15T16:30:00.000Z'); // still within Mon window in Algiers?
    // 16:30 UTC = 17:30 Algiers — after 17:00 close. Next open Tue 09:00 Algiers.
    const next = effectiveNextOpenAt(
      'TEMPORARY_CLOSED',
      until,
      mondayNineToSeventeen,
      mondayOpen,
    );
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(until.getTime());
  });
});
