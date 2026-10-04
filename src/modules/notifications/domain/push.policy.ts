import {
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
          channel_id: MERCHANT_ORDER_ANDROID_CHANNEL_ID,
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
          aps: { sound: 'default', 'thread-id': 'merchant-orders' },
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
