export const NOTIFICATION_QUEUE_NAME = 'notifications';

export const NOTIFICATION_JOB_RECOVERY = 'recovery';

export const NOTIFICATION_JOB_PUSH_SEND = 'push-send';

export const NOTIFICATION_JOBS = Symbol('NOTIFICATION_JOBS');

export type PushSendJobData = {
  notificationId: string;
  /** DeviceToken ids already accepted by the provider in earlier attempts. */
  acceptedTokenIds?: string[];
  firstProviderReference?: string | null;
};

export type NotificationJobs = {
  ensureRecoverySchedule(): Promise<void>;
  enqueuePushSend(notificationId: string): Promise<void>;
};
