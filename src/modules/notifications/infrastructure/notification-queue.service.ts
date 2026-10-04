import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  NOTIFICATIONS_RECOVERY_JOB_ID,
  notificationPushSendJobId,
} from '../../../infrastructure/queue/bull-job-id';
import {
  NOTIFICATION_JOB_PUSH_SEND,
  NOTIFICATION_JOB_RECOVERY,
  NOTIFICATION_QUEUE_NAME,
  type NotificationJobs,
  type PushSendJobData,
} from '../domain/notification.jobs';

const JOB_ATTEMPTS = 3;
const JOB_BACKOFF_MS = 1000;

function isDuplicateJobError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|JobId is already used|already waiting|already delayed|already active/i.test(
    message,
  );
}

@Injectable()
export class NotificationQueueService
  implements NotificationJobs, OnModuleInit
{
  private readonly logger = new Logger(NotificationQueueService.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE_NAME) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureRecoverySchedule();
  }

  async ensureRecoverySchedule(): Promise<void> {
    const every = this.config.get<number>(
      'notifications.recoveryIntervalMs',
      30_000,
    );
    await this.addRepeatableRecovery(every);
  }

  /**
   * One job per Notification (deduplicated by jobId). Bounded retry with
   * exponential backoff for transient provider errors only.
   */
  async enqueuePushSend(notificationId: string): Promise<void> {
    const data: PushSendJobData = { notificationId };
    try {
      await this.queue.add(NOTIFICATION_JOB_PUSH_SEND, data, {
        jobId: notificationPushSendJobId(notificationId),
        attempts: Math.max(
          1,
          this.config.get<number>('push.sendMaxAttempts', 5),
        ),
        backoff: {
          type: 'exponential',
          delay: this.config.get<number>('push.sendBackoffMs', 2_000),
        },
        removeOnComplete: true,
        removeOnFail: 100,
      });
    } catch (error) {
      if (isDuplicateJobError(error)) {
        return;
      }
      throw error;
    }
  }

  /**
   * BullMQ 6 ignores `repeat` on `Queue.add` (legacy repeatables were removed),
   * so the recurring sweep must be a Job Scheduler. `every <= 0` runs once.
   */
  private async addRepeatableRecovery(every: number): Promise<void> {
    const opts = {
      attempts: JOB_ATTEMPTS,
      backoff: { type: 'exponential' as const, delay: JOB_BACKOFF_MS },
      removeOnComplete: true,
      removeOnFail: 20,
    };
    try {
      if (every > 0) {
        await this.queue.upsertJobScheduler(
          NOTIFICATIONS_RECOVERY_JOB_ID,
          { every },
          { name: NOTIFICATION_JOB_RECOVERY, data: {}, opts },
        );
        return;
      }
      await this.queue.add(
        NOTIFICATION_JOB_RECOVERY,
        {},
        { ...opts, jobId: NOTIFICATIONS_RECOVERY_JOB_ID },
      );
    } catch (error) {
      if (isDuplicateJobError(error)) {
        return;
      }
      this.logger.warn(
        `Notification recovery schedule failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
