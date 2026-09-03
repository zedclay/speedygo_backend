import {
  buildDriverEarningAmounts,
  normalizeDriverEarningListQuery,
  requireDriverRemunerationMinor,
} from './driver-remuneration.policy';
import { DRIVER_REMUNERATION_ERROR_CODES } from './driver-remuneration.errors';

describe('driver-remuneration.policy', () => {
  it('copies snapshot remuneration with zero bonus/adjustment', () => {
    const amounts = buildDriverEarningAmounts(300);
    expect(amounts).toEqual({
      baseRemunerationMinor: 300,
      bonusMinor: 0,
      adjustmentMinor: 0,
      netEarningMinor: 300,
      status: 'EARNED',
    });
  });

  it('allows zero remuneration', () => {
    expect(buildDriverEarningAmounts(0).netEarningMinor).toBe(0);
    expect(requireDriverRemunerationMinor(0)).toBe(0);
  });

  it('rejects negative remuneration', () => {
    expect(() => requireDriverRemunerationMinor(-1)).toThrow();
    try {
      buildDriverEarningAmounts(-5);
      throw new Error('expected invalid');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        DRIVER_REMUNERATION_ERROR_CODES.DRIVER_EARNING_AMOUNT_INVALID,
      );
    }
  });

  it('normalizes list pagination bounds', () => {
    expect(normalizeDriverEarningListQuery({})).toEqual({
      limit: 50,
      offset: 0,
    });
    expect(() => normalizeDriverEarningListQuery({ limit: 0 })).toThrow();
    expect(() => normalizeDriverEarningListQuery({ offset: -1 })).toThrow();
  });
});
