import { AvailabilityError } from './branch-availability.errors';
import { validateAndNormalizeAvailabilityPut } from './branch-availability.policy';

describe('validateAndNormalizeAvailabilityPut', () => {
  const now = new Date('2026-09-24T12:00:00.000Z');

  it('accepts FOLLOW_SCHEDULE and clears reason/message/until', () => {
    const n = validateAndNormalizeAvailabilityPut(
      {
        expectedVersion: 0,
        mode: 'FOLLOW_SCHEDULE',
        reasonCode: 'PEAK_KITCHEN',
        customerMessage: 'ignored',
        closedUntil: null,
      },
      now,
    );
    expect(n.mode).toBe('FOLLOW_SCHEDULE');
    expect(n.reasonCode).toBeNull();
    expect(n.customerMessage).toBeNull();
    expect(n.closedUntil).toBeNull();
  });

  it('rejects past closedUntil for TEMPORARY_CLOSED', () => {
    expect(() =>
      validateAndNormalizeAvailabilityPut(
        {
          expectedVersion: 1,
          mode: 'TEMPORARY_CLOSED',
          closedUntil: '2026-09-24T11:00:00.000Z',
        },
        now,
      ),
    ).toThrow(AvailabilityError);
  });

  it('rejects closedUntil on FORCE_CLOSED', () => {
    expect(() =>
      validateAndNormalizeAvailabilityPut(
        {
          expectedVersion: 1,
          mode: 'FORCE_CLOSED',
          closedUntil: '2026-09-24T15:00:00.000Z',
        },
        now,
      ),
    ).toThrow(AvailabilityError);
  });

  it('requires future closedUntil for TEMPORARY_CLOSED', () => {
    const n = validateAndNormalizeAvailabilityPut(
      {
        expectedVersion: 1,
        mode: 'TEMPORARY_CLOSED',
        reasonCode: 'LUNCH_BREAK',
        closedUntil: '2026-09-24T15:00:00.000Z',
      },
      now,
    );
    expect(n.closedUntil?.toISOString()).toBe('2026-09-24T15:00:00.000Z');
    expect(n.reasonCode).toBe('LUNCH_BREAK');
  });
});
