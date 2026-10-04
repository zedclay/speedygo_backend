/**
 * BullMQ custom jobId helper.
 *
 * BullMQ 6.x rejects custom jobIds that contain `:` unless they split into
 * exactly three colon-separated segments (legacy repeatable-job form).
 * Two-segment ids such as `matching:recovery` and `notifications:recovery`
 * throw `Custom Id cannot contain :` — which silently broke recovery schedules.
 *
 * Strategy: hyphen-separated segments, no `:`, preserving uniqueness and
 * deduplication intent (one start per order, one timeout per assignment, etc.).
 * Do not replace separators inside UUID segments (UUIDs already use `-`).
 */
export function bullCustomJobId(...parts: readonly string[]): string {
  if (parts.length === 0) {
    throw new Error('bullCustomJobId requires at least one part');
  }
  for (const part of parts) {
    if (typeof part !== 'string' || part.length === 0) {
      throw new Error('bullCustomJobId parts must be non-empty strings');
    }
    if (part.includes(':')) {
      throw new Error(
        `bullCustomJobId parts must not contain ':': ${JSON.stringify(part)}`,
      );
    }
  }
  return parts.join('-');
}

/** Singleton repeatable matching recovery job. */
export const MATCHING_RECOVERY_JOB_ID = bullCustomJobId(
  'matching',
  'recovery',
);

/** Singleton repeatable notifications recovery job. */
export const NOTIFICATIONS_RECOVERY_JOB_ID = bullCustomJobId(
  'notifications',
  'recovery',
);

export function notificationPushSendJobId(notificationId: string): string {
  return bullCustomJobId('notifications', 'push', notificationId);
}

export function matchingStartJobId(orderId: string): string {
  return bullCustomJobId('matching', 'start', orderId);
}

export function matchingTimeoutJobId(assignmentId: string): string {
  return bullCustomJobId('matching', 'timeout', assignmentId);
}

export function matchingRetryJobId(deliveryId: string): string {
  return bullCustomJobId('matching', 'retry', deliveryId);
}
