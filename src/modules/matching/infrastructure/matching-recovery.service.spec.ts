import { ConfigService } from '@nestjs/config';
import { DeliveryRepository } from '../../delivery/infrastructure/delivery.repository';
import type { MatchingJobs } from '../domain/matching.jobs';
import { ASSIGNMENT_STATUS_OFFERED } from '../domain/matching.policy';
import { AssignmentRepository } from './assignment.repository';
import { MatchingRecoveryService } from './matching-recovery.service';

describe('MatchingRecoveryService', () => {
  it('enqueues start, remaining timeout, and retry without duplicating Delivery', async () => {
    const enqueueStart = jest.fn().mockResolvedValue(undefined);
    const enqueueTimeout = jest.fn().mockResolvedValue(undefined);
    const enqueueRetry = jest.fn().mockResolvedValue(undefined);
    const jobs: MatchingJobs = {
      enqueueStart,
      enqueueTimeout,
      enqueueRetry,
      scheduleAfterMatch: jest.fn().mockResolvedValue(undefined),
    };
    const recovery = new MatchingRecoveryService(
      {
        listReadyOrderIdsMissingDelivery: () => Promise.resolve(['order-1']),
        listSearchingDeliveryIds: () =>
          Promise.resolve(['delivery-open', 'delivery-idle']),
      } as unknown as DeliveryRepository,
      {
        findOpenByDelivery: (deliveryId: string) =>
          Promise.resolve(
            deliveryId === 'delivery-open'
              ? {
                  id: 'asg-1',
                  deliveryId,
                  driverId: 'driver-1',
                  status: ASSIGNMENT_STATUS_OFFERED,
                  assignedAt: '2026-09-02T00:00:20.000Z',
                  acceptedAt: null,
                  releasedAt: null,
                }
              : null,
          ),
      } as unknown as AssignmentRepository,
      jobs,
      {
        get: (key: string, fallback: number) => {
          if (key === 'matching.recoveryBatchSize') {
            return 50;
          }
          if (key === 'matching.offerTimeoutMs') {
            return 30_000;
          }
          return fallback;
        },
      } as unknown as ConfigService,
    );
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-09-02T00:00:25.000Z'));
    const result = await recovery.recover();
    expect(result).toEqual({ starts: 1, retries: 1, timeouts: 1 });
    expect(enqueueStart.mock.calls).toEqual([['order-1']]);
    expect(enqueueRetry.mock.calls).toEqual([['delivery-idle']]);
    expect(enqueueTimeout.mock.calls).toEqual([['asg-1', 25_000]]);
    jest.restoreAllMocks();
  });
});
