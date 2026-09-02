import { MatchingService } from '../application/matching.service';
import {
  MATCHING_JOB_RECOVERY,
  MATCHING_JOB_RETRY,
  MATCHING_JOB_START,
  MATCHING_JOB_TIMEOUT,
} from '../domain/matching.jobs';
import { MatchingRecoveryService } from './matching-recovery.service';
import { MatchingProcessor } from './matching.processor';

describe('MatchingProcessor', () => {
  it('routes start, timeout, retry, and recovery jobs', async () => {
    const matching = {
      startForReadyOrder: jest.fn().mockResolvedValue({ offered: true }),
      expireAndContinue: jest.fn().mockResolvedValue({ offered: false }),
      matchDelivery: jest.fn().mockResolvedValue({ offered: false }),
    };
    const recovery = { recover: jest.fn().mockResolvedValue({ starts: 0 }) };
    const processor = new MatchingProcessor(
      matching as unknown as MatchingService,
      recovery as unknown as MatchingRecoveryService,
    );
    await processor.process({
      name: MATCHING_JOB_START,
      data: { orderId: 'order-1' },
    } as never);
    await processor.process({
      name: MATCHING_JOB_TIMEOUT,
      data: { assignmentId: 'asg-1' },
    } as never);
    await processor.process({
      name: MATCHING_JOB_RETRY,
      data: { deliveryId: 'del-1' },
    } as never);
    await processor.process({
      name: MATCHING_JOB_RECOVERY,
      data: {},
    } as never);
    expect(matching.startForReadyOrder).toHaveBeenCalledWith('order-1');
    expect(matching.expireAndContinue).toHaveBeenCalledWith('asg-1');
    expect(matching.matchDelivery).toHaveBeenCalledWith('del-1');
    expect(recovery.recover).toHaveBeenCalled();
  });
});
