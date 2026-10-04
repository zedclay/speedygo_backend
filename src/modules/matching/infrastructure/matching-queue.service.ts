import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  MATCHING_RECOVERY_JOB_ID,
  matchingRetryJobId,
  matchingStartJobId,
  matchingTimeoutJobId,
} from '../../../infrastructure/queue/bull-job-id';
import { DELIVERY_STATUS_SEARCHING_DRIVER } from '../../delivery/domain/delivery.policy';
import {
  MATCHING_JOB_RECOVERY,
  MATCHING_JOB_RETRY,
  MATCHING_JOB_START,
  MATCHING_JOB_TIMEOUT,
  MATCHING_QUEUE_NAME,
  type MatchingJobs,
} from '../domain/matching.jobs';
import type { MatchingStartResult } from '../domain/matching.types';

const JOB_ATTEMPTS = 5;
const JOB_BACKOFF_MS = 1000;

function isDuplicateJobError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|JobId is already used|already waiting|already delayed|already active/i.test(
    message,
  );
}

@Injectable()
export class MatchingQueueService implements MatchingJobs, OnModuleInit {
  private readonly logger = new Logger(MatchingQueueService.name);

  constructor(
    @InjectQueue(MATCHING_QUEUE_NAME) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const every = this.config.get<number>(
      'matching.recoveryIntervalMs',
      15_000,
    );
    await this.scheduleRecovery(every);
  }

  async enqueueStart(orderId: string): Promise<void> {
    await this.addJob(
      MATCHING_JOB_START,
      { orderId },
      matchingStartJobId(orderId),
    );
  }

  async enqueueTimeout(assignmentId: string, delayMs?: number): Promise<void> {
    const delay =
      delayMs ?? this.config.get<number>('matching.offerTimeoutMs', 30_000);
    await this.addJob(
      MATCHING_JOB_TIMEOUT,
      { assignmentId },
      matchingTimeoutJobId(assignmentId),
      Math.max(0, delay),
    );
  }

  async enqueueRetry(deliveryId: string): Promise<void> {
    const delay = this.config.get<number>('matching.retryDelayMs', 15_000);
    await this.addJob(
      MATCHING_JOB_RETRY,
      { deliveryId },
      matchingRetryJobId(deliveryId),
      delay,
    );
  }

  async scheduleAfterMatch(result: MatchingStartResult): Promise<void> {
    if (result.offered && result.assignment) {
      await this.enqueueTimeout(result.assignment.id);
      return;
    }
    if (
      result.deliveryStatus === DELIVERY_STATUS_SEARCHING_DRIVER &&
      !result.assignment
    ) {
      await this.enqueueRetry(result.deliveryId);
    }
  }

  /**
   * BullMQ 6 ignores `repeat` on `Queue.add` (legacy repeatables were removed),
   * so the recurring sweep must be a Job Scheduler. `every <= 0` runs once.
   */
  private async scheduleRecovery(every: number): Promise<void> {
    if (every <= 0) {
      await this.addJob(MATCHING_JOB_RECOVERY, {}, MATCHING_RECOVERY_JOB_ID);
      return;
    }
    try {
      await this.queue.upsertJobScheduler(
        MATCHING_RECOVERY_JOB_ID,
        { every },
        {
          name: MATCHING_JOB_RECOVERY,
          data: {},
          opts: {
            attempts: JOB_ATTEMPTS,
            backoff: { type: 'exponential', delay: JOB_BACKOFF_MS },
            removeOnComplete: true,
            removeOnFail: 20,
          },
        },
      );
    } catch (error) {
      this.logger.warn(
        `Matching recovery schedule failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async addJob(
    name: string,
    data: Record<string, string>,
    jobId: string,
    delay?: number,
  ): Promise<void> {
    try {
      await this.queue.add(name, data, {
        jobId,
        delay,
        attempts: JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: JOB_BACKOFF_MS },
        removeOnComplete: true,
        removeOnFail: 20,
      });
    } catch (error) {
      if (isDuplicateJobError(error)) {
        return;
      }
      this.logger.warn(
        `Matching job ${jobId} enqueue failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
