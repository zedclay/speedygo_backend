import {
  assertPaymentConfig,
  resolveChargilyMode,
  shouldUseTestPaymentProvider,
} from './payment-config.validation';

const validChargily = {
  chargilySecretKey: 'sk_test_placeholder',
  chargilyMode: 'live',
  returnUrl: 'https://app.example/return',
  cancelUrl: 'https://app.example/cancel',
  webhookUrl: 'https://api.example/api/v1/payments/webhooks/chargily',
};

describe('assertPaymentConfig', () => {
  it('forbids the test provider in production', () => {
    expect(() =>
      assertPaymentConfig({
        nodeEnv: 'production',
        provider: 'test',
        ...validChargily,
      }),
    ).toThrow('PAYMENT_PROVIDER=test is forbidden when NODE_ENV=production');
  });

  it('fails production when the provider is missing', () => {
    expect(() =>
      assertPaymentConfig({
        nodeEnv: 'production',
        provider: '',
        ...validChargily,
      }),
    ).toThrow('PAYMENT_PROVIDER is required when NODE_ENV=production');
  });

  it('fails production Chargily when the secret is missing', () => {
    expect(() =>
      assertPaymentConfig({
        nodeEnv: 'production',
        provider: 'chargily',
        ...validChargily,
        chargilySecretKey: '',
      }),
    ).toThrow('CHARGILY_SECRET_KEY is required');
  });

  it('fails production Chargily test mode', () => {
    expect(() =>
      assertPaymentConfig({
        nodeEnv: 'production',
        provider: 'chargily',
        ...validChargily,
        chargilyMode: 'test',
      }),
    ).toThrow('CHARGILY_MODE must be live when NODE_ENV=production');
  });

  it('accepts valid production Chargily configuration', () => {
    expect(() =>
      assertPaymentConfig({
        nodeEnv: 'production',
        provider: 'chargily',
        ...validChargily,
      }),
    ).not.toThrow();
  });

  it('rejects an unknown production provider name', () => {
    expect(() =>
      assertPaymentConfig({
        nodeEnv: 'production',
        provider: 'stripe',
        ...validChargily,
      }),
    ).toThrow('not a configured electronic payment adapter');
  });

  it('allows the test provider outside production', () => {
    expect(() =>
      assertPaymentConfig({
        nodeEnv: 'test',
        provider: 'test',
        chargilySecretKey: '',
        chargilyMode: '',
        returnUrl: '',
        cancelUrl: '',
        webhookUrl: '',
      }),
    ).not.toThrow();
  });

  it('selects the test adapter only outside production', () => {
    expect(shouldUseTestPaymentProvider('test', '')).toBe(true);
    expect(shouldUseTestPaymentProvider('development', 'test')).toBe(true);
    expect(shouldUseTestPaymentProvider('production', '')).toBe(false);
    expect(shouldUseTestPaymentProvider('production', 'test')).toBe(false);
    expect(shouldUseTestPaymentProvider('production', 'chargily')).toBe(false);
  });

  it('defaults Chargily mode to live in production and test otherwise', () => {
    expect(resolveChargilyMode('production', '')).toBe('live');
    expect(resolveChargilyMode('test', '')).toBe('test');
    expect(resolveChargilyMode('development', 'live')).toBe('live');
  });
});
