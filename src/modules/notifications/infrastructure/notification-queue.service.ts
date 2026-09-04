import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  NOTIFICATION_JOB_RECOVERY,
  NOTIFICATION_QUEUE_NAME,
  type NotificationJobs,
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

  private async addRepeatableRecovery(every: number): Promise<void> {
    try {
      await this.queue.add(
        NOTIFICATION_JOB_RECOVERY,
        {},
        {
          jobId: 'notifications:recovery',
          attempts: JOB_ATTEMPTS,
          backoff: { type: 'exponential', delay: JOB_BACKOFF_MS },
          removeOnComplete: true,
          removeOnFail: 20,
          ...(every
            ? { repeat: { every }, delay: undefined }
            : {}),
        },
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
