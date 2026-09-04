import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationRecoveryService } from '../application/notification-recovery.service';
import {
  NOTIFICATION_JOB_RECOVERY,
  NOTIFICATION_QUEUE_NAME,
} from '../domain/notification.jobs';

@Processor(NOTIFICATION_QUEUE_NAME)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly recovery: NotificationRecoveryService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === NOTIFICATION_JOB_RECOVERY) {
      await this.recovery.recover();
      return;
    }
    this.logger.warn(`Unknown notification job ${job.name}`);
  }
}
