export type PaymentRecord = {
  id: string;
  orderId: string;
  method: string;
  status: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentTransactionRecord = {
  id: string;
  paymentId: string;
  provider: string;
  providerReference: string | null;
  status: string;
  amountMinor: number;
  idempotencyKey: string;
  processedAt: string | null;
  createdAt: string;
};

export type CustomerPaymentView = {
  paymentId: string;
  method: string;
  status: string;
  amountMinor: number;
  currency: string;
  provider: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaymentInitiateView = CustomerPaymentView & {
  attemptId: string;
  checkoutUrl: string | null;
};

export type ProviderCreateInput = {
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  returnUrl: string;
  cancelUrl: string;
  webhookUrl: string;
  paymentId: string;
  attemptId: string;
};

export type ProviderSession = {
  provider: string;
  providerReference: string;
  checkoutUrl: string;
};

export type ProviderCheckoutStatus =
  'pending' | 'processing' | 'paid' | 'failed' | 'canceled';

export type ProviderCheckoutSnapshot = {
  provider: string;
  providerReference: string;
  checkoutUrl: string | null;
  providerStatus: ProviderCheckoutStatus;
  amountMinor: number;
  currency: string;
};

export type ProviderWebhookEvent = {
  eventId: string;
  eventType: string;
  providerReference: string;
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNSUPPORTED';
  amountMinor: number;
  currency: string;
};

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const CHARGILY_HTTP = Symbol('CHARGILY_HTTP');
