/**
 * Notifications Foundation v1.0 — schema-bound safe subset.
 *
 * Persistent IN_APP history on Account via Notification.
 * No NotificationPreference table → no preference feature.
 * No sourceId column → idempotency key encoded in category: `{TYPE}:{sourceId}`.
 * PUSH provider not integrated → never fake Push success.
 */

export const NOTIFICATION_CHANNEL_IN_APP = 'IN_APP';
export const NOTIFICATION_CHANNEL_PUSH = 'PUSH';

export const NOTIFICATION_CHANNELS_V1 = [
  NOTIFICATION_CHANNEL_IN_APP,
  NOTIFICATION_CHANNEL_PUSH,
] as const;

export type NotificationChannelV1 = (typeof NOTIFICATION_CHANNELS_V1)[number];

/** Delivery-log status vocabulary (application-frozen; schema is VARCHAR). */
export const NOTIFICATION_DELIVERY_PENDING = 'PENDING';
export const NOTIFICATION_DELIVERY_SENT = 'SENT';
export const NOTIFICATION_DELIVERY_FAILED = 'FAILED';
export const NOTIFICATION_DELIVERY_SKIPPED_NOT_CONFIGURED =
  'SKIPPED_NOT_CONFIGURED';

export const NOTIFICATION_DELIVERY_STATUSES_V1 = [
  NOTIFICATION_DELIVERY_PENDING,
  NOTIFICATION_DELIVERY_SENT,
  NOTIFICATION_DELIVERY_FAILED,
  NOTIFICATION_DELIVERY_SKIPPED_NOT_CONFIGURED,
] as const;

export type NotificationDeliveryStatusV1 =
  (typeof NOTIFICATION_DELIVERY_STATUSES_V1)[number];

/**
 * User-facing notification types (v1.0 source matrix).
 * Stored in category as `{TYPE}:{sourceId}` for source idempotency.
 */
export const NOTIFICATION_TYPE_ORDER_ACCEPTED = 'ORDER_ACCEPTED';
export const NOTIFICATION_TYPE_ORDER_REJECTED = 'ORDER_REJECTED';
export const NOTIFICATION_TYPE_ORDER_READY = 'ORDER_READY';
export const NOTIFICATION_TYPE_DRIVER_ASSIGNED = 'DRIVER_ASSIGNED';
export const NOTIFICATION_TYPE_DELIVERY_COMPLETED = 'DELIVERY_COMPLETED';
export const NOTIFICATION_TYPE_MATCH_OFFER = 'MATCH_OFFER';
export const NOTIFICATION_TYPE_PAYMENT_SUCCEEDED = 'PAYMENT_SUCCEEDED';
export const NOTIFICATION_TYPE_REFUND_REFUNDED = 'REFUND_REFUNDED';
export const NOTIFICATION_TYPE_SETTLEMENT_FINALIZED = 'SETTLEMENT_FINALIZED';
export const NOTIFICATION_TYPE_DRIVER_EARNING_CREATED =
  'DRIVER_EARNING_CREATED';
export const NOTIFICATION_TYPE_MERCHANT_ORDER_CREATED =
  'MERCHANT_ORDER_CREATED';

export const NOTIFICATION_TYPES_V1 = [
  NOTIFICATION_TYPE_ORDER_ACCEPTED,
  NOTIFICATION_TYPE_ORDER_REJECTED,
  NOTIFICATION_TYPE_ORDER_READY,
  NOTIFICATION_TYPE_DRIVER_ASSIGNED,
  NOTIFICATION_TYPE_DELIVERY_COMPLETED,
  NOTIFICATION_TYPE_MATCH_OFFER,
  NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
  NOTIFICATION_TYPE_REFUND_REFUNDED,
  NOTIFICATION_TYPE_SETTLEMENT_FINALIZED,
  NOTIFICATION_TYPE_DRIVER_EARNING_CREATED,
  NOTIFICATION_TYPE_MERCHANT_ORDER_CREATED,
] as const;

export type NotificationTypeV1 = (typeof NOTIFICATION_TYPES_V1)[number];

export const NOTIFICATION_LIST_DEFAULT_LIMIT = 20;
export const NOTIFICATION_LIST_MAX_LIMIT = 50;
export const NOTIFICATION_LIST_MAX_OFFSET = 10_000;

export const DEVICE_TOKEN_PLATFORMS = ['ios', 'android', 'web'] as const;
export type DeviceTokenPlatform = (typeof DEVICE_TOKEN_PLATFORMS)[number];

export type NotificationRecord = {
  id: string;
  accountId: string;
  templateId: string | null;
  title: string;
  body: string;
  category: string;
  read: boolean;
  createdAt: string;
};

export type NotificationDeliveryLogRecord = {
  id: string;
  notificationId: string;
  channel: string;
  status: string;
  providerReference: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type DeviceTokenRecord = {
  id: string;
  accountId: string;
  deviceId: string | null;
  token: string;
  platform: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EmitNotificationInput = {
  type: NotificationTypeV1;
  sourceId: string;
  accountId: string;
  title: string;
  body: string;
};

export type NotificationView = {
  id: string;
  type: NotificationTypeV1;
  sourceId: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};

export type NotificationListView = {
  items: NotificationView[];
  limit: number;
  offset: number;
  total: number;
  unreadCount: number;
};
