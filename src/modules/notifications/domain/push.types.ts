export const PUSH_GATEWAY = Symbol('PUSH_GATEWAY');

export const PUSH_PROVIDER_DISABLED = 'disabled';
export const PUSH_PROVIDER_FCM = 'fcm';

/** Android channel created by the Merchant app for new-order alerts. */
export const MERCHANT_ORDER_ANDROID_CHANNEL_ID = 'merchant_new_orders';

export type PushMessage = {
  token: string;
  platform: string;
  title: string;
  body: string;
  /** String-only data payload (FCM requirement). */
  data: Record<string, string>;
  /** Same key collapses repeated attempts for one source in the OS tray. */
  collapseKey: string;
  ttlSeconds: number;
};

export type PushSendOutcome =
  /** Provider accepted the message. Not proof of device receipt. */
  | { kind: 'accepted'; providerReference: string }
  /** Token is unregistered / invalid / for another sender → deactivate. */
  | { kind: 'invalid_token'; code: string }
  /** Retryable (quota, 5xx, network, timeout). */
  | { kind: 'transient'; code: string }
  /** Non-retryable provider/config/payload error. Token stays active. */
  | { kind: 'permanent'; code: string };

export type PushFailureOutcome = Exclude<PushSendOutcome, { kind: 'accepted' }>;

export type PushGateway = {
  readonly provider: string;
  isConfigured(): boolean;
  send(message: PushMessage): Promise<PushSendOutcome>;
};
