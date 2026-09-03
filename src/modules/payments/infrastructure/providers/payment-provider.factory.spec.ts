import { UnconfiguredPaymentProvider } from './unconfigured-payment.provider';
import { TestPaymentProvider } from './test-payment.provider';
import { ChargilyPaymentProvider } from './chargily-payment.provider';
import { createConfiguredPaymentProvider } from './payment-provider.factory';
import type { ChargilyHttpClient } from './chargily-http.client';

const chargily = {
  secretKey: 'secret',
  returnUrl: 'https://app.example/return',
  cancelUrl: 'https://app.example/cancel',
  webhookUrl: 'https://api.example/webhooks/chargily',
  locale: 'ar',
};

const http: ChargilyHttpClient = {
  request: () => Promise.resolve({ status: 200, json: {} }),
};

describe('createConfiguredPaymentProvider', () => {
  it('never resolves the test adapter in production', () => {
    const provider = createConfiguredPaymentProvider({
      nodeEnv: 'production',
      provider: 'test',
      testWebhookSecret: 'secret',
      chargilyHttp: http,
      chargily,
    });
    expect(provider).toBeInstanceOf(UnconfiguredPaymentProvider);
    expect(provider).not.toBeInstanceOf(TestPaymentProvider);
  });

  it('resolves Chargily in production when configured', () => {
    const provider = createConfiguredPaymentProvider({
      nodeEnv: 'production',
      provider: 'chargily',
      testWebhookSecret: 'secret',
      chargilyHttp: http,
      chargily,
    });
    expect(provider).toBeInstanceOf(ChargilyPaymentProvider);
  });

  it('resolves the test adapter outside production', () => {
    const provider = createConfiguredPaymentProvider({
      nodeEnv: 'test',
      provider: 'test',
      testWebhookSecret: 'secret',
      chargilyHttp: null,
      chargily,
    });
    expect(provider).toBeInstanceOf(TestPaymentProvider);
  });
});
