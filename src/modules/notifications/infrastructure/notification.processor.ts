import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationRecoveryService } from '../application/notification-recovery.service';
import { PushDispatchService } from '../application/push-dispatch.service';
import {
  NOTIFICATION_JOB_PUSH_SEND,
  NOTIFICATION_JOB_RECOVERY,
  NOTIFICATION_QUEUE_NAME,
  type PushSendJobData,
} from '../domain/notification.jobs';

@Processor(NOTIFICATION_QUEUE_NAME)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly recovery: NotificationRecoveryService,
    private readonly push: PushDispatchService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === NOTIFICATION_JOB_RECOVERY) {
      await this.recovery.recover();
      return;
    }
    if (job.name === NOTIFICATION_JOB_PUSH_SEND) {
      const attempts = job.opts.attempts ?? 1;
      const result = await this.push.dispatch(job.data as PushSendJobData, {
        finalAttempt: job.attemptsMade + 1 >= attempts,
      });
      if (result.kind === 'retry') {
        await job.updateData(result.data);
        throw new Error(`push transient failure code=${result.code}`);
      }
      return;
    }
    this.logger.warn(`Unknown notification job ${job.name}`);
  }
}
