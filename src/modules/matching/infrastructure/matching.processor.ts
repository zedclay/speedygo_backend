import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MatchingService } from '../application/matching.service';
import {
  MATCHING_JOB_RECOVERY,
  MATCHING_JOB_RETRY,
  MATCHING_JOB_START,
  MATCHING_JOB_TIMEOUT,
  MATCHING_QUEUE_NAME,
} from '../domain/matching.jobs';
import { MatchingRecoveryService } from './matching-recovery.service';

type MatchingJobData = {
  orderId?: string;
  assignmentId?: string;
  deliveryId?: string;
};

@Processor(MATCHING_QUEUE_NAME)
export class MatchingProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchingProcessor.name);

  constructor(
    private readonly matching: MatchingService,
    private readonly recovery: MatchingRecoveryService,
  ) {
    super();
  }

  async process(job: Job<MatchingJobData>): Promise<void> {
    switch (job.name) {
      case MATCHING_JOB_START:
        await this.matching.startForReadyOrder(String(job.data.orderId));
        return;
      case MATCHING_JOB_TIMEOUT:
        await this.matching.expireAndContinue(String(job.data.assignmentId));
        return;
      case MATCHING_JOB_RETRY:
        await this.matching.matchDelivery(String(job.data.deliveryId));
        return;
      case MATCHING_JOB_RECOVERY:
        await this.recovery.recover();
        return;
      default:
        this.logger.warn(`Unknown matching job ${job.name}`);
    }
  }
}
