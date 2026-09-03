import { signTestWebhook, TestPaymentProvider } from './test-payment.provider';

const SECRET = 'unit-test-webhook-secret';

describe('TestPaymentProvider', () => {
  let provider: TestPaymentProvider;

  beforeEach(() => {
    provider = new TestPaymentProvider(SECRET);
  });

  it('creates a new session per distinct local attempt key', async () => {
    const first = await provider.createPayment({
      amountMinor: 1700,
      currency: 'DZD',
      idempotencyKey: 'init:pay:1',
      returnUrl: '',
      cancelUrl: '',
      webhookUrl: '',
      paymentId: 'pay-1',
      attemptId: 'att-1',
    });
    const second = await provider.createPayment({
      amountMinor: 1700,
      currency: 'DZD',
      idempotencyKey: 'init:pay:1',
      returnUrl: '',
      cancelUrl: '',
      webhookUrl: '',
      paymentId: 'pay-1',
      attemptId: 'att-1',
    });
    expect(second.providerReference).toBe(first.providerReference);
    expect(first.checkoutUrl).toBe(
      `test://checkout/${first.providerReference}`,
    );
  });

  it('accepts a valid signature over the raw body', async () => {
    const session = await provider.createPayment({
      amountMinor: 1700,
      currency: 'DZD',
      idempotencyKey: 'init:pay:2',
      returnUrl: '',
      cancelUrl: '',
      webhookUrl: '',
      paymentId: 'pay-1',
      attemptId: 'att-2',
    });
    const raw = Buffer.from(
      JSON.stringify({
        eventId: 'evt-1',
        providerReference: session.providerReference,
        status: 'SUCCEEDED',
        amountMinor: 1700,
        currency: 'DZD',
      }),
    );
    expect(provider.verifyWebhook(raw, signTestWebhook(SECRET, raw))).toBe(
      true,
    );
    expect(provider.parseWebhook(raw).eventId).toBe('evt-1');
  });

  it('rejects a missing, invalid, or tampered signature', () => {
    const raw = Buffer.from('{"eventId":"evt-1"}');
    expect(provider.verifyWebhook(raw, undefined)).toBe(false);
    expect(provider.verifyWebhook(raw, 'sha256=deadbeef')).toBe(false);
    const signed = signTestWebhook(SECRET, raw);
    const tampered = Buffer.from('{"eventId":"evt-2"}');
    expect(provider.verifyWebhook(tampered, signed)).toBe(false);
  });

  it('fails closed when the webhook secret is empty', () => {
    const empty = new TestPaymentProvider('');
    const raw = Buffer.from('{}');
    expect(empty.verifyWebhook(raw, signTestWebhook(SECRET, raw))).toBe(false);
  });
});
