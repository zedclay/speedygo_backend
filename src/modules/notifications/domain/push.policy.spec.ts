import {
  buildCustomerOrderPushMessage,
  buildMatchOfferPushMessage,
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

  it('customer order payload uses customer_order_updates and 1h TTL', () => {
    const msg = buildCustomerOrderPushMessage({
      token: 'tok',
      platform: 'android',
      title: 'Commande prête',
      body: 'Votre commande est prête',
      type: 'ORDER_READY',
      notificationId: 'n',
      orderId: 'o',
    });
    const body = toFcmV1Body(msg, 1_000_000) as {
      message: {
        data: Record<string, string>;
        android: { ttl: string; notification: { channel_id: string } };
      };
    };
    expect(body.message.data).toEqual({
      type: 'ORDER_READY',
      orderId: 'o',
      notificationId: 'n',
    });
    expect(body.message.android.ttl).toBe('3600s');
    expect(body.message.android.notification.channel_id).toBe(
      'customer_order_updates',
    );
  });

  it('MATCH_OFFER payload uses driver_match_offers and caller-supplied remaining TTL', () => {
    const msg = buildMatchOfferPushMessage({
      token: 'tok',
      platform: 'android',
      title: 'Nouvelle course',
      body: 'Une course vous est proposée',
      notificationId: 'n',
      assignmentId: 'a',
      ttlSeconds: 17,
    });
    const body = toFcmV1Body(msg, 1_000_000) as {
      message: {
        data: Record<string, string>;
        android: {
          ttl: string;
          collapse_key: string;
          notification: { channel_id: string };
        };
        apns: { headers: Record<string, string> };
      };
    };
    expect(body.message.data).toEqual({
      type: 'MATCH_OFFER',
      sourceId: 'a',
      offerId: 'a',
      notificationId: 'n',
    });
    expect(body.message.android.ttl).toBe('17s');
    expect(body.message.android.collapse_key).toBe('a');
    expect(body.message.android.notification.channel_id).toBe(
      'driver_match_offers',
    );
    expect(body.message.apns.headers['apns-expiration']).toBe(String(1000 + 17));
  });
});
