import { createHash } from 'node:crypto';
import {
  notificationConfigurationInvalid,
  notificationDeviceTokenInvalid,
  notificationSourceInvalid,
  notificationTypeInvalid,
} from './notification.errors';
import {
  DEVICE_TOKEN_PLATFORMS,
  NOTIFICATION_LIST_DEFAULT_LIMIT,
  NOTIFICATION_LIST_MAX_LIMIT,
  NOTIFICATION_LIST_MAX_OFFSET,
  NOTIFICATION_TYPES_V1,
  type DeviceTokenPlatform,
  type NotificationRecord,
  type NotificationTypeV1,
  type NotificationView,
} from './notification.types';

/** Advisory lock class: 'SGNT' */
export const NOTIFICATION_ADVISORY_LOCK_CLASS = 0x53474e54;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Encode source idempotency into Notification.category (VARCHAR 64).
 * Format: `{TYPE}:{sourceId}` — unique per Account via application lock+lookup.
 */
export function buildNotificationCategory(
  type: NotificationTypeV1,
  sourceId: string,
): string {
  requireNotificationType(type);
  requireSourceId(sourceId);
  const category = `${type}:${sourceId}`;
  if (category.length > 64) {
    throw notificationConfigurationInvalid(
      'Notification category exceeds 64 characters',
    );
  }
  return category;
}

export function parseNotificationCategory(category: string): {
  type: NotificationTypeV1;
  sourceId: string;
} {
  const sep = category.indexOf(':');
  if (sep <= 0 || sep === category.length - 1) {
    throw notificationConfigurationInvalid(
      'Notification category is not a typed source key',
    );
  }
  const type = category.slice(0, sep);
  const sourceId = category.slice(sep + 1);
  return {
    type: requireNotificationType(type),
    sourceId: requireSourceId(sourceId),
  };
}

export function requireNotificationType(raw: string): NotificationTypeV1 {
  if (!(NOTIFICATION_TYPES_V1 as readonly string[]).includes(raw)) {
    throw notificationTypeInvalid();
  }
  return raw as NotificationTypeV1;
}

export function requireSourceId(raw: string): string {
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    throw notificationSourceInvalid();
  }
  return raw.toLowerCase();
}

export function requireAccountId(raw: string): string {
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    throw notificationConfigurationInvalid('Account id is invalid');
  }
  return raw.toLowerCase();
}

export function requireTitleBody(title: string, body: string): void {
  if (
    typeof title !== 'string' ||
    typeof body !== 'string' ||
    title.trim().length === 0 ||
    body.trim().length === 0 ||
    title.length > 500 ||
    body.length > 4000
  ) {
    throw notificationConfigurationInvalid(
      'Notification title/body is invalid',
    );
  }
}

export function requireDeviceTokenPlatform(raw: string): DeviceTokenPlatform {
  if (!(DEVICE_TOKEN_PLATFORMS as readonly string[]).includes(raw)) {
    throw notificationDeviceTokenInvalid('Device token platform is invalid');
  }
  return raw as DeviceTokenPlatform;
}

export function requirePushToken(raw: string): string {
  if (typeof raw !== 'string') {
    throw notificationDeviceTokenInvalid();
  }
  const token = raw.trim();
  if (token.length < 8 || token.length > 4096) {
    throw notificationDeviceTokenInvalid();
  }
  return token;
}

export function notificationAdvisoryObjectId(
  type: NotificationTypeV1,
  sourceId: string,
  accountId: string,
): number {
  const digest = createHash('sha256')
    .update(`sg:notification:${type}:${sourceId}:${accountId}`)
    .digest();
  return digest.readInt32BE(0);
}

export function toNotificationView(row: NotificationRecord): NotificationView {
  const parsed = parseNotificationCategory(row.category);
  return {
    id: row.id,
    type: parsed.type,
    sourceId: parsed.sourceId,
    title: row.title,
    body: row.body,
    read: row.read,
    createdAt: row.createdAt,
  };
}

export function normalizeNotificationListQuery(input: {
  limit?: number;
  offset?: number;
}): { limit: number; offset: number } {
  const limit = input.limit ?? NOTIFICATION_LIST_DEFAULT_LIMIT;
  const offset = input.offset ?? 0;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > NOTIFICATION_LIST_MAX_LIMIT ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > NOTIFICATION_LIST_MAX_OFFSET
  ) {
    throw notificationConfigurationInvalid(
      'Notification list pagination is out of range',
    );
  }
  return { limit, offset };
}

/** Copy factories — no financial internals / PII. */
export function copyOrderAccepted(publicReference: string): {
  title: string;
  body: string;
} {
  return {
    title: 'Order accepted',
    body: `Your order ${publicReference} was accepted by the merchant.`,
  };
}

export function copyOrderRejected(publicReference: string): {
  title: string;
  body: string;
} {
  return {
    title: 'Order rejected',
    body: `Your order ${publicReference} was rejected by the merchant.`,
  };
}

export function copyOrderReady(publicReference: string): {
  title: string;
  body: string;
} {
  return {
    title: 'Order ready',
    body: `Your order ${publicReference} is ready for pickup.`,
  };
}

export function copyDriverAssigned(publicReference: string): {
  title: string;
  body: string;
} {
  return {
    title: 'Driver assigned',
    body: `A driver was assigned to your order ${publicReference}.`,
  };
}

export function copyDeliveryCompleted(publicReference: string): {
  title: string;
  body: string;
} {
  return {
    title: 'Order delivered',
    body: `Your order ${publicReference} was delivered.`,
  };
}

export function copyMatchOffer(): { title: string; body: string } {
  return {
    title: 'New delivery offer',
    body: 'You have a new delivery offer. Open the app to accept or reject before it expires.',
  };
}

export function copyPaymentSucceeded(publicReference: string): {
  title: string;
  body: string;
} {
  return {
    title: 'Payment successful',
    body: `Payment for order ${publicReference} succeeded.`,
  };
}

export function copyRefundRefunded(publicReference: string): {
  title: string;
  body: string;
} {
  return {
    title: 'Refund completed',
    body: `A refund for order ${publicReference} was completed.`,
  };
}

export function copySettlementFinalized(): { title: string; body: string } {
  return {
    title: 'Settlement finalized',
    body: 'A merchant settlement statement is available. This is not a bank payout confirmation.',
  };
}

export function copyDriverEarningCreated(): { title: string; body: string } {
  return {
    title: 'Earning recorded',
    body: 'A delivery earning was recorded for your account.',
  };
}

export function copyMerchantOrderCreated(publicReference: string): {
  title: string;
  body: string;
} {
  return {
    title: 'New order',
    body: `New order ${publicReference} requires attention.`,
  };
}
