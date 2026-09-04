export const NOTIFICATION_QUEUE_NAME = 'notifications';

export const NOTIFICATION_JOB_RECOVERY = 'recovery';

export const NOTIFICATION_JOBS = Symbol('NOTIFICATION_JOBS');

export type NotificationJobs = {
  ensureRecoverySchedule(): Promise<void>;
};
