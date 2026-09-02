import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryRepository } from '../../delivery/infrastructure/delivery.repository';
import { MATCHING_JOBS, type MatchingJobs } from '../domain/matching.jobs';
import { isOpenOffer, remainingOfferDelayMs } from '../domain/matching.policy';
import { AssignmentRepository } from './assignment.repository';

@Injectable()
export class MatchingRecoveryService {
  private readonly logger = new Logger(MatchingRecoveryService.name);

  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly assignments: AssignmentRepository,
    @Inject(MATCHING_JOBS) private readonly jobs: MatchingJobs,
    private readonly config: ConfigService,
  ) {}

  async recover(): Promise<{
    starts: number;
    retries: number;
    timeouts: number;
  }> {
    const batch = this.config.get<number>('matching.recoveryBatchSize', 50);
    const offerTimeoutMs = this.config.get<number>(
      'matching.offerTimeoutMs',
      30_000,
    );
    const missing =
      await this.deliveries.listReadyOrderIdsMissingDelivery(batch);
    const searching = await this.deliveries.listSearchingDeliveryIds(batch);
    let starts = 0;
    let retries = 0;
    let timeouts = 0;
    for (const orderId of missing) {
      await this.jobs.enqueueStart(orderId);
      starts += 1;
    }
    for (const deliveryId of searching) {
      const open = await this.assignments.findOpenByDelivery(deliveryId);
      if (open && isOpenOffer(open.status, open.releasedAt)) {
        await this.jobs.enqueueTimeout(
          open.id,
          remainingOfferDelayMs(open.assignedAt, offerTimeoutMs),
        );
        timeouts += 1;
        continue;
      }
      await this.jobs.enqueueRetry(deliveryId);
      retries += 1;
    }
    if (starts + retries + timeouts > 0) {
      this.logger.debug(
        `Matching recovery enqueued starts=${starts} retries=${retries} timeouts=${timeouts}`,
      );
    }
    return { starts, retries, timeouts };
  }
}
