import {
  deriveIsPreparationLate,
  computeEstimatedReadyAt,
} from './preparation-estimate.policy';

describe('preparation estimate policy', () => {
  it('starts estimate clock from accept instant', () => {
    const accept = new Date('2026-09-24T12:00:00.000Z');
    expect(computeEstimatedReadyAt(accept, 25).toISOString()).toBe(
      '2026-09-24T12:25:00.000Z',
    );
  });

  it('marks late only while ACCEPTED/PREPARING past ready', () => {
    const ready = '2026-09-24T12:00:00.000Z';
    const now = new Date('2026-09-24T12:05:00.000Z');
    expect(
      deriveIsPreparationLate({
        estimatedReadyAt: ready,
        fulfillmentStatus: 'PREPARING',
        orderStatus: 'ACTIVE',
        now,
      }),
    ).toBe(true);
    expect(
      deriveIsPreparationLate({
        estimatedReadyAt: ready,
        fulfillmentStatus: 'READY',
        orderStatus: 'ACTIVE',
        now,
      }),
    ).toBe(false);
    expect(
      deriveIsPreparationLate({
        estimatedReadyAt: ready,
        fulfillmentStatus: 'PREPARING',
        orderStatus: 'CANCELLED',
        now,
      }),
    ).toBe(false);
  });
});
