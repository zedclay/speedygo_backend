import { timingSafeEqual } from 'node:crypto';
import { PAYMENT_ERROR_CODES } from '../../domain/payment.errors';
import {
  ChargilyPaymentProvider,
  CHARGILY_LIVE_BASE_URL,
  CHARGILY_PAY_V2_AMOUNT_UNIT,
  CHARGILY_TEST_BASE_URL,
  chargilyBaseUrl,
  refuseUnverifiedChargilyCheckoutAmount,
  signChargilyWebhook,
} from './chargily-payment.provider';

const SECRET = 'chargily-unit-secret';
const PAYMENT_ID = '66666666-6666-7666-8666-666666666666';
const ATTEMPT_ID = '77777777-7777-7777-8777-777777777777';

function checkoutPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chk_1',
    amount: 1700,
    currency: 'dzd',
    status: 'pending',
    checkout_url: 'https://pay.chargily.net/test/checkouts/chk_1/pay',
    fees: 80,
    fees_on_merchant: 80,
    fees_on_customer: 0,
    ...overrides,
  };
}

describe('ChargilyPaymentProvider', () => {
  let http: { request: jest.Mock };
  let provider: ChargilyPaymentProvider;

  beforeEach(() => {
    http = {
      request: jest.fn(),
    };
    provider = new ChargilyPaymentProvider(http, {
      secretKey: SECRET,
      returnUrl: 'https://app.example/return',
      cancelUrl: 'https://app.example/cancel',
      webhookUrl: 'https://api.example/api/v1/payments/webhooks/chargily',
      locale: 'ar',
    });
  });

  it('uses official live and test base URLs', () => {
    expect(chargilyBaseUrl('live')).toBe(CHARGILY_LIVE_BASE_URL);
    expect(chargilyBaseUrl('test')).toBe(CHARGILY_TEST_BASE_URL);
  });

  it('marks Chargily Pay v2 amount unit UNVERIFIED until official docs/SDK name it', () => {
    expect(CHARGILY_PAY_V2_AMOUNT_UNIT).toBe('UNVERIFIED');
  });

  it('refuses checkout create while Pay v2 amount unit is UNVERIFIED', async () => {
    expect(CHARGILY_PAY_V2_AMOUNT_UNIT).toBe('UNVERIFIED');
    try {
      refuseUnverifiedChargilyCheckoutAmount();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toMatchObject({
        code: PAYMENT_ERROR_CODES.PAYMENT_PROVIDER_AMOUNT_UNIT_UNVERIFIED,
      });
    }
    await expect(
      provider.createPayment({
        amountMinor: 65000,
        currency: 'DZD',
        idempotencyKey: `init:${PAYMENT_ID}:${ATTEMPT_ID}`,
        returnUrl: 'https://app.example/return',
        cancelUrl: 'https://app.example/cancel',
        webhookUrl: 'https://api.example/api/v1/payments/webhooks/chargily',
        paymentId: PAYMENT_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).rejects.toMatchObject({
      code: PAYMENT_ERROR_CODES.PAYMENT_PROVIDER_AMOUNT_UNIT_UNVERIFIED,
    });
    expect(http.request).not.toHaveBeenCalled();
  });

  it('does not send assumed centimes or DZD majors to Chargily', async () => {
    await expect(
      provider.createPayment({
        amountMinor: 65050,
        currency: 'DZD',
        idempotencyKey: `init:${PAYMENT_ID}:${ATTEMPT_ID}`,
        returnUrl: 'https://app.example/return',
        cancelUrl: 'https://app.example/cancel',
        webhookUrl: 'https://api.example/api/v1/payments/webhooks/chargily',
        paymentId: PAYMENT_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).rejects.toBeDefined();
    expect(http.request).not.toHaveBeenCalled();
  });

  it('retrieves checkout status and URL from the provider response', async () => {
    for (const status of [
      'pending',
      'processing',
      'paid',
      'failed',
      'canceled',
    ] as const) {
      http.request.mockResolvedValueOnce({
        status: 200,
        json: checkoutPayload({
          status,
          checkout_url: `https://pay.chargily.net/test/checkouts/chk_1/${status}`,
        }),
      });
      const snapshot = await provider.queryPayment({
        providerReference: 'chk_1',
      });
      expect(http.request).toHaveBeenLastCalledWith({
        method: 'GET',
        path: '/checkouts/chk_1',
      });
      expect(snapshot?.providerStatus).toBe(status);
      expect(snapshot?.checkoutUrl).toContain(status);
      expect(snapshot?.amountMinor).toBe(1700);
      expect(snapshot?.currency).toBe('DZD');
    }
  });

  it('accepts Chargily checkout url field as checkout URL', async () => {
    http.request.mockResolvedValue({
      status: 200,
      json: {
        id: 'chk_2',
        amount: 1700,
        status: 'pending',
        url: 'https://pay.chargily.net/test/checkouts/chk_2/pay',
      },
    });
    const snapshot = await provider.queryPayment({
      providerReference: 'chk_2',
    });
    expect(snapshot?.checkoutUrl).toBe(
      'https://pay.chargily.net/test/checkouts/chk_2/pay',
    );
  });

  it('verifies the official signature header over raw bytes', () => {
    const raw = Buffer.from('{"id":"evt-1","type":"checkout.paid"}');
    const signature = signChargilyWebhook(SECRET, raw);
    expect(provider.verifyWebhook(raw, signature)).toBe(true);
    expect(provider.verifyWebhook(raw, undefined)).toBe(false);
    expect(provider.verifyWebhook(raw, 'deadbeef')).toBe(false);
    const tampered = Buffer.from('{"id":"evt-2","type":"checkout.paid"}');
    expect(provider.verifyWebhook(tampered, signature)).toBe(false);
    const expected = Buffer.from(signature, 'utf8');
    const provided = Buffer.from(signature, 'utf8');
    expect(timingSafeEqual(expected, provided)).toBe(true);
  });

  it('maps checkout.paid and checkout.failed and ignores unknown signed types', () => {
    const paid = Buffer.from(
      JSON.stringify({
        id: 'evt-paid',
        type: 'checkout.paid',
        data: {
          id: 'chk_1',
          amount: 1700,
          status: 'paid',
          fees: 80,
          fees_on_merchant: 80,
          fees_on_customer: 0,
        },
      }),
    );
    expect(provider.parseWebhook(paid)).toEqual({
      eventId: 'evt-paid',
      eventType: 'checkout.paid',
      providerReference: 'chk_1',
      status: 'SUCCEEDED',
      amountMinor: 1700,
      currency: 'DZD',
    });

    const failed = Buffer.from(
      JSON.stringify({
        id: 'evt-failed',
        type: 'checkout.failed',
        data: {
          id: 'chk_1',
          amount: 1700,
          currency: 'dzd',
          status: 'failed',
        },
      }),
    );
    expect(provider.parseWebhook(failed).status).toBe('FAILED');

    const unknown = Buffer.from(
      JSON.stringify({
        id: 'evt-other',
        type: 'checkout.updated',
        data: { id: 'chk_1', amount: 1700, status: 'pending' },
      }),
    );
    expect(provider.parseWebhook(unknown).status).toBe('UNSUPPORTED');
  });

  it('keeps stub webhook integers opaque (not a SpeedyGo unit proof)', () => {
    const paid650 = Buffer.from(
      JSON.stringify({
        id: 'evt-paid-650',
        type: 'checkout.paid',
        data: {
          id: 'chk_650',
          amount: 65000,
          currency: 'dzd',
          status: 'paid',
        },
      }),
    );
    const signature = signChargilyWebhook(SECRET, paid650);
    expect(provider.verifyWebhook(paid650, signature)).toBe(true);
    expect(provider.parseWebhook(paid650)).toMatchObject({
      eventType: 'checkout.paid',
      status: 'SUCCEEDED',
      amountMinor: 65000,
      currency: 'DZD',
    });

    const paidFractional = Buffer.from(
      JSON.stringify({
        id: 'evt-paid-65050',
        type: 'checkout.paid',
        data: {
          id: 'chk_65050',
          amount: 65050,
          currency: 'dzd',
          status: 'paid',
        },
      }),
    );
    expect(provider.parseWebhook(paidFractional).amountMinor).toBe(65050);
  });

  it('does not treat provider fees as the Payment amount', async () => {
    http.request.mockResolvedValue({
      status: 200,
      json: checkoutPayload({ amount: 1700, fees: 9999 }),
    });
    const snapshot = await provider.queryPayment({
      providerReference: 'chk_1',
    });
    expect(snapshot?.amountMinor).toBe(1700);
  });

  it('rejects malformed webhook JSON', () => {
    expect(() => provider.parseWebhook(Buffer.from('not-json'))).toThrow();
  });
});
