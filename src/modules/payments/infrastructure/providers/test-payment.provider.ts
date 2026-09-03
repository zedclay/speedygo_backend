import { createHmac, timingSafeEqual } from 'node:crypto';
import { createUuidV7 } from '../../../../common/utils/uuid-v7';
import { paymentWebhookInvalidSignature } from '../../domain/payment.errors';
import { PAYMENT_PROVIDER_TEST } from '../../domain/payment.policy';
import type { PaymentProvider } from '../../domain/ports/payment-provider.port';
import type {
  ProviderCheckoutSnapshot,
  ProviderCreateInput,
  ProviderSession,
  ProviderWebhookEvent,
} from '../../domain/payment.types';

const SIGNATURE_PREFIX = 'sha256=';

function checkoutUrl(providerReference: string): string {
  return `test://checkout/${providerReference}`;
}

function parseStatus(value: unknown): ProviderWebhookEvent['status'] {
  if (
    value === 'SUCCEEDED' ||
    value === 'FAILED' ||
    value === 'CANCELLED' ||
    value === 'UNSUPPORTED'
  ) {
    return value;
  }
  throw paymentWebhookInvalidSignature();
}

export class TestPaymentProvider implements PaymentProvider {
  readonly name = PAYMENT_PROVIDER_TEST;
  private readonly sessionsByKey = new Map<string, ProviderSession>();
  private readonly sessionsByReference = new Map<
    string,
    ProviderCheckoutSnapshot
  >();

  constructor(private readonly webhookSecret: string) {}

  createPayment(input: ProviderCreateInput): Promise<ProviderSession> {
    const reused = this.sessionsByKey.get(input.idempotencyKey);
    if (reused) {
      return Promise.resolve(reused);
    }
    const providerReference = `test_${createUuidV7()}`;
    const snapshot: ProviderCheckoutSnapshot = {
      provider: this.name,
      providerReference,
      checkoutUrl: checkoutUrl(providerReference),
      providerStatus: 'pending',
      amountMinor: input.amountMinor,
      currency: input.currency,
    };
    this.sessionsByReference.set(providerReference, snapshot);
    const session: ProviderSession = {
      provider: this.name,
      providerReference,
      checkoutUrl: snapshot.checkoutUrl ?? checkoutUrl(providerReference),
    };
    this.sessionsByKey.set(input.idempotencyKey, session);
    return Promise.resolve(session);
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean {
    if (!this.webhookSecret || !signature?.startsWith(SIGNATURE_PREFIX)) {
      return false;
    }
    const expected = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    const provided = signature.slice(SIGNATURE_PREFIX.length);
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(provided, 'utf8');
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
    if (!parsed || typeof parsed !== 'object') {
      throw paymentWebhookInvalidSignature();
    }
    const body = parsed as Record<string, unknown>;
    if (
      typeof body.eventId !== 'string' ||
      body.eventId.length === 0 ||
      typeof body.providerReference !== 'string' ||
      body.providerReference.length === 0 ||
      typeof body.amountMinor !== 'number' ||
      !Number.isInteger(body.amountMinor) ||
      body.amountMinor < 0 ||
      typeof body.currency !== 'string'
    ) {
      throw paymentWebhookInvalidSignature();
    }
    const status = parseStatus(body.status);
    const existing = this.sessionsByReference.get(body.providerReference);
    if (existing) {
      existing.providerStatus =
        status === 'SUCCEEDED'
          ? 'paid'
          : status === 'CANCELLED'
            ? 'canceled'
            : status === 'FAILED'
              ? 'failed'
              : existing.providerStatus;
    }
    return {
      eventId: body.eventId,
      eventType:
        typeof body.eventType === 'string' ? body.eventType : 'test.event',
      providerReference: body.providerReference,
      status,
      amountMinor: body.amountMinor,
      currency: body.currency,
    };
  }

  queryPayment(input: {
    providerReference: string;
  }): Promise<ProviderCheckoutSnapshot | null> {
    return Promise.resolve(
      this.sessionsByReference.get(input.providerReference) ?? null,
    );
  }

  setCheckoutStatus(
    providerReference: string,
    providerStatus: ProviderCheckoutSnapshot['providerStatus'],
  ): void {
    const existing = this.sessionsByReference.get(providerReference);
    if (existing) {
      existing.providerStatus = providerStatus;
    }
  }
}

export function signTestWebhook(secret: string, rawBody: Buffer): string {
  return `${SIGNATURE_PREFIX}${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}
