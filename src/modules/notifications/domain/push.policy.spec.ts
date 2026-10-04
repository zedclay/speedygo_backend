import {
  buildMerchantOrderPushMessage,
  classifyFcmError,
  toFcmV1Body,
} from './push.policy';

const fcmError = (status: string, errorCode?: string, message = '') => ({
  error: {
    status,
    message,
    details: errorCode
      ? [
          {
            '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
            errorCode,
          },
        ]
      : [],
  },
});

describe('classifyFcmError', () => {
  it('UNREGISTERED / SENDER_ID_MISMATCH → invalid_token', () => {
    expect(classifyFcmError(404, fcmError('NOT_FOUND', 'UNREGISTERED'))).toEqual({
      kind: 'invalid_token',
      code: 'UNREGISTERED',
    });
    expect(
      classifyFcmError(403, fcmError('PERMISSION_DENIED', 'SENDER_ID_MISMATCH')),
    ).toEqual({ kind: 'invalid_token', code: 'SENDER_ID_MISMATCH' });
  });

  it('INVALID_ARGUMENT about the registration token → invalid_token; payload errors → permanent', () => {
    expect(
      classifyFcmError(
        400,
        fcmError(
          'INVALID_ARGUMENT',
          'INVALID_ARGUMENT',
          'The registration token is not a valid FCM registration token',
        ),
      ).kind,
    ).toBe('invalid_token');
    expect(
      classifyFcmError(
        400,
        fcmError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'Invalid JSON payload'),
      ),
    ).toEqual({ kind: 'permanent', code: 'INVALID_ARGUMENT' });
  });

  it('quota / 5xx → transient; APNs auth → permanent', () => {
    expect(classifyFcmError(429, fcmError('RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED')).kind).toBe('transient');
    expect(classifyFcmError(503, fcmError('UNAVAILABLE', 'UNAVAILABLE')).kind).toBe('transient');
    expect(classifyFcmError(500, null).kind).toBe('transient');
    expect(
      classifyFcmError(401, fcmError('UNAUTHENTICATED', 'THIRD_PARTY_AUTH_ERROR')),
    ).toEqual({ kind: 'permanent', code: 'THIRD_PARTY_AUTH_ERROR' });
  });
});

describe('FCM v1 body', () => {
  it('carries order routing data, collapse keys, TTL and Android channel', () => {
    const msg = buildMerchantOrderPushMessage({
      token: 'tok',
      platform: 'ios',
      title: 'Nouvelle commande',
      body: 'Commande sgo_x',
      notificationId: 'n',
      orderId: 'o',
      merchantId: 'm',
      branchId: 'b',
    });
    const body = toFcmV1Body(msg, 1_000_000) as {
      message: {
        token: string;
        data: Record<string, string>;
        android: { collapse_key: string; ttl: string; notification: { channel_id: string } };
        apns: { headers: Record<string, string> };
      };
    };
    expect(body.message.token).toBe('tok');
    expect(body.message.data.orderId).toBe('o');
    expect(body.message.android.collapse_key).toBe('o');
    expect(body.message.android.ttl).toBe('1800s');
    expect(body.message.android.notification.channel_id).toBe('merchant_new_orders');
    expect(body.message.apns.headers['apns-collapse-id']).toBe('o');
    expect(body.message.apns.headers['apns-expiration']).toBe(String(1000 + 1800));
  });
});
