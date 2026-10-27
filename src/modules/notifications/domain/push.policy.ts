import {
  CUSTOMER_ORDER_ANDROID_CHANNEL_ID,
  DRIVER_MATCH_ANDROID_CHANNEL_ID,
  MERCHANT_ORDER_ANDROID_CHANNEL_ID,
  type PushFailureOutcome,
  type PushMessage,
} from './push.types';

/** New-order pushes older than this are dropped by the provider/OS. */
export const MERCHANT_ORDER_PUSH_TTL_SECONDS = 30 * 60;

export function buildMerchantOrderPushMessage(input: {
  token: string;
  platform: string;
  title: string;
  body: string;
  notificationId: string;
  orderId: string;
  merchantId: string;
  branchId: string;
}): PushMessage {
  return {
    token: input.token,
    platform: input.platform,
    title: input.title,
    body: input.body,
    data: {
      type: 'MERCHANT_ORDER_CREATED',
      orderId: input.orderId,
      merchantId: input.merchantId,
      branchId: input.branchId,
      notificationId: input.notificationId,
    },
    collapseKey: input.orderId,
    ttlSeconds: MERCHANT_ORDER_PUSH_TTL_SECONDS,
    androidChannelId: MERCHANT_ORDER_ANDROID_CHANNEL_ID,
    apnsThreadId: 'merchant-orders',
  };
}

/** Customer order-lifecycle pushes older than this are dropped by the OS. */
export const CUSTOMER_ORDER_PUSH_TTL_SECONDS = 60 * 60;

export function buildCustomerOrderPushMessage(input: {
  token: string;
  platform: string;
  title: string;
  body: string;
  type: string;
  notificationId: string;
  orderId: string;
}): PushMessage {
  return {
    token: input.token,
    platform: input.platform,
    title: input.title,
    body: input.body,
    data: {
      type: input.type,
      orderId: input.orderId,
      notificationId: input.notificationId,
    },
    collapseKey: input.orderId,
    ttlSeconds: CUSTOMER_ORDER_PUSH_TTL_SECONDS,
    androidChannelId: CUSTOMER_ORDER_ANDROID_CHANNEL_ID,
    apnsThreadId: 'customer-orders',
  };
}

export function buildMatchOfferPushMessage(input: {
  token: string;
  platform: string;
  title: string;
  body: string;
  notificationId: string;
  assignmentId: string;
  ttlSeconds: number;
}): PushMessage {
  return {
    token: input.token,
    platform: input.platform,
    title: input.title,
    body: input.body,
    data: {
      type: 'MATCH_OFFER',
      sourceId: input.assignmentId,
      offerId: input.assignmentId,
      notificationId: input.notificationId,
    },
    collapseKey: input.assignmentId,
    ttlSeconds: input.ttlSeconds,
    androidChannelId: DRIVER_MATCH_ANDROID_CHANNEL_ID,
    apnsThreadId: 'driver-match-offers',
  };
}

/** FCM HTTP v1 request body for one token. */
export function toFcmV1Body(message: PushMessage, nowMs: number): unknown {
  return {
    message: {
      token: message.token,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: {
        priority: 'HIGH',
        ttl: `${message.ttlSeconds}s`,
        collapse_key: message.collapseKey,
        notification: {
          channel_id: message.androidChannelId,
          tag: message.collapseKey,
          sound: 'default',
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
          'apns-collapse-id': message.collapseKey.slice(0, 64),
          'apns-expiration': String(
            Math.floor(nowMs / 1000) + message.ttlSeconds,
          ),
        },
        payload: {
          aps: { sound: 'default', 'thread-id': message.apnsThreadId },
        },
      },
    },
  };
}

type FcmErrorBody = {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: Array<{ '@type'?: string; errorCode?: string }>;
  };
};

/**
 * Classify an FCM HTTP v1 error response.
 * https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode
 */
export function classifyFcmError(
  httpStatus: number,
  body: unknown,
): PushFailureOutcome {
  const err = (body as FcmErrorBody | null)?.error;
  const fcmCode = err?.details?.find((d) =>
    (d['@type'] ?? '').endsWith('google.firebase.fcm.v1.FcmError'),
  )?.errorCode;
  const status = err?.status ?? '';
  const code = fcmCode ?? (status || `HTTP_${httpStatus}`);

  if (fcmCode === 'UNREGISTERED' || fcmCode === 'SENDER_ID_MISMATCH') {
    return { kind: 'invalid_token', code: fcmCode };
  }
  if (
    (fcmCode === 'INVALID_ARGUMENT' || status === 'INVALID_ARGUMENT') &&
    /registration token/i.test(err?.message ?? '')
  ) {
    return { kind: 'invalid_token', code: 'INVALID_REGISTRATION_TOKEN' };
  }
  if (
    fcmCode === 'QUOTA_EXCEEDED' ||
    fcmCode === 'UNAVAILABLE' ||
    fcmCode === 'INTERNAL' ||
    httpStatus === 429 ||
    httpStatus >= 500
  ) {
    return { kind: 'transient', code };
  }
  return { kind: 'permanent', code };
}
