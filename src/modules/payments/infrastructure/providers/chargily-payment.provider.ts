import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  paymentProviderUnavailable,
  paymentWebhookInvalidSignature,
} from '../../domain/payment.errors';
import {
  normalizeProviderCurrency,
  PAYMENT_CURRENCY_DZD,
  PAYMENT_PROVIDER_CHARGILY,
} from '../../domain/payment.policy';
import type { PaymentProvider } from '../../domain/ports/payment-provider.port';
import type {
  ProviderCheckoutSnapshot,
  ProviderCheckoutStatus,
  ProviderCreateInput,
  ProviderSession,
  ProviderWebhookEvent,
} from '../../domain/payment.types';
import type { ChargilyHttpClient } from './chargily-http.client';

export const CHARGILY_LIVE_BASE_URL = 'https://pay.chargily.net/api/v2';
export const CHARGILY_TEST_BASE_URL = 'https://pay.chargily.net/test/api/v2';

export type ChargilyProviderConfig = {
  secretKey: string;
  returnUrl: string;
  cancelUrl: string;
  webhookUrl: string;
  locale: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readAmount(record: Record<string, unknown>): number | null {
  const value = record.amount;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

function mapCheckoutStatus(
  value: string | null,
): ProviderCheckoutStatus | null {
  if (
    value === 'pending' ||
    value === 'processing' ||
    value === 'paid' ||
    value === 'failed' ||
    value === 'canceled'
  ) {
    return value;
  }
  return null;
}

function checkoutUrlFrom(record: Record<string, unknown>): string | null {
  return readString(record, 'checkout_url') ?? readString(record, 'url');
}

function snapshotFromCheckout(
  record: Record<string, unknown>,
): ProviderCheckoutSnapshot | null {
  const id = readString(record, 'id');
  const status = mapCheckoutStatus(readString(record, 'status'));
  const amountMinor = readAmount(record);
  if (!id || !status || amountMinor === null) {
    return null;
  }
  return {
    provider: PAYMENT_PROVIDER_CHARGILY,
    providerReference: id,
    checkoutUrl: checkoutUrlFrom(record),
    providerStatus: status,
    amountMinor,
    currency: normalizeProviderCurrency(
      readString(record, 'currency') ?? PAYMENT_CURRENCY_DZD,
    ),
  };
}

export function signChargilyWebhook(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function chargilyBaseUrl(mode: string): string {
  return mode === 'live' ? CHARGILY_LIVE_BASE_URL : CHARGILY_TEST_BASE_URL;
}

export class ChargilyPaymentProvider implements PaymentProvider {
  readonly name = PAYMENT_PROVIDER_CHARGILY;

  constructor(
    private readonly http: ChargilyHttpClient,
    private readonly config: ChargilyProviderConfig,
  ) {}

  async createPayment(input: ProviderCreateInput): Promise<ProviderSession> {
    const response = await this.http.request({
      method: 'POST',
      path: '/checkouts',
      body: {
        amount: input.amountMinor,
        currency: 'dzd',
        success_url: this.config.returnUrl || input.returnUrl,
        failure_url: this.config.cancelUrl || input.cancelUrl,
        webhook_endpoint: this.config.webhookUrl || input.webhookUrl,
        locale: this.config.locale,
        chargily_pay_fees_allocation: 'merchant',
        metadata: {
          speedygoPaymentId: input.paymentId,
          speedygoAttemptId: input.attemptId,
        },
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw paymentProviderUnavailable();
    }
    const record = asRecord(response.json);
    const snapshot = record ? snapshotFromCheckout(record) : null;
    if (!snapshot?.checkoutUrl) {
      throw paymentProviderUnavailable();
    }
    return {
      provider: this.name,
      providerReference: snapshot.providerReference,
      checkoutUrl: snapshot.checkoutUrl,
    };
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean {
    if (!this.config.secretKey || !signature) {
      return false;
    }
    const expected = signChargilyWebhook(this.config.secretKey, rawBody);
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(signature, 'utf8');
    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, providedBuffer);
  }

  parseWebhook(rawBody: Buffer): ProviderWebhookEvent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw paymentWebhookInvalidSignature();
    }
    const event = asRecord(parsed);
    const data = event ? asRecord(event.data) : null;
    const eventId = event ? readString(event, 'id') : null;
    const eventType = event ? readString(event, 'type') : null;
    const checkoutId = data ? readString(data, 'id') : null;
    if (!event || !eventId || !eventType || !data || !checkoutId) {
      throw paymentWebhookInvalidSignature();
    }
    const amountMinor = readAmount(data) ?? 0;
    const currency = normalizeProviderCurrency(
      readString(data, 'currency') ?? PAYMENT_CURRENCY_DZD,
    );
    let status: ProviderWebhookEvent['status'] = 'UNSUPPORTED';
    if (eventType === 'checkout.paid') {
      status = 'SUCCEEDED';
    } else if (eventType === 'checkout.failed') {
      status = 'FAILED';
    }
    return {
      eventId,
      eventType,
      providerReference: checkoutId,
      status,
      amountMinor,
      currency,
    };
  }

  async queryPayment(input: {
    providerReference: string;
  }): Promise<ProviderCheckoutSnapshot | null> {
    const response = await this.http.request({
      method: 'GET',
      path: `/checkouts/${encodeURIComponent(input.providerReference)}`,
    });
    if (response.status === 404) {
      return null;
    }
    if (response.status < 200 || response.status >= 300) {
      throw paymentProviderUnavailable();
    }
    const record = asRecord(response.json);
    return record ? snapshotFromCheckout(record) : null;
  }
}
