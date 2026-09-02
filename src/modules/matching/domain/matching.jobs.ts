import type { MatchingStartResult } from './matching.types';

export const MATCHING_QUEUE_NAME = 'matching';

export const MATCHING_JOB_START = 'start';
export const MATCHING_JOB_TIMEOUT = 'timeout';
export const MATCHING_JOB_RETRY = 'retry';
export const MATCHING_JOB_RECOVERY = 'recovery';

export const MATCHING_JOBS = Symbol('MATCHING_JOBS');

export type MatchingJobs = {
  enqueueStart(orderId: string): Promise<void>;
  enqueueTimeout(assignmentId: string, delayMs?: number): Promise<void>;
  enqueueRetry(deliveryId: string): Promise<void>;
  scheduleAfterMatch(result: MatchingStartResult): Promise<void>;
};
