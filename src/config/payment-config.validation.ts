import {
  PAYMENT_PROVIDER_CHARGILY,
  PAYMENT_PROVIDER_TEST,
} from '../modules/payments/domain/payment.policy';

export type PaymentRuntimeConfig = {
  nodeEnv: string;
  provider: string;
  chargilySecretKey: string;
  chargilyMode: string;
  returnUrl: string;
  cancelUrl: string;
  webhookUrl: string;
};

function required(name: string, value: string): void {
  if (!value.trim()) {
    throw new Error(`${name} is required`);
  }
}

export function resolveChargilyMode(
  nodeEnv: string,
  configuredMode: string,
): 'test' | 'live' {
  const mode = configuredMode.trim().toLowerCase();
  if (mode === 'test' || mode === 'live') {
    return mode;
  }
  return nodeEnv === 'production' ? 'live' : 'test';
}

export function assertPaymentConfig(config: PaymentRuntimeConfig): void {
  const production = config.nodeEnv === 'production';
  const provider = config.provider.trim();
  const mode = resolveChargilyMode(config.nodeEnv, config.chargilyMode);

  if (production) {
    if (provider === PAYMENT_PROVIDER_TEST) {
      throw new Error(
        'PAYMENT_PROVIDER=test is forbidden when NODE_ENV=production',
      );
    }
    if (!provider) {
      throw new Error('PAYMENT_PROVIDER is required when NODE_ENV=production');
    }
    if (provider !== PAYMENT_PROVIDER_CHARGILY) {
      throw new Error(
        `PAYMENT_PROVIDER=${provider} is not a configured electronic payment adapter`,
      );
    }
    required('CHARGILY_SECRET_KEY', config.chargilySecretKey);
    required('PAYMENT_RETURN_URL', config.returnUrl);
    required('PAYMENT_CANCEL_URL', config.cancelUrl);
    required('PAYMENT_WEBHOOK_URL', config.webhookUrl);
    if (mode !== 'live') {
      throw new Error('CHARGILY_MODE must be live when NODE_ENV=production');
    }
    return;
  }

  if (
    provider &&
    provider !== PAYMENT_PROVIDER_TEST &&
    provider !== PAYMENT_PROVIDER_CHARGILY
  ) {
    throw new Error(
      `PAYMENT_PROVIDER=${provider} is not a configured electronic payment adapter`,
    );
  }

  if (provider === PAYMENT_PROVIDER_CHARGILY) {
    required('CHARGILY_SECRET_KEY', config.chargilySecretKey);
    if (mode !== 'test' && mode !== 'live') {
      throw new Error('CHARGILY_MODE must be test or live');
    }
  }
}

export function shouldUseTestPaymentProvider(
  nodeEnv: string,
  provider: string,
): boolean {
  if (nodeEnv === 'production') {
    return false;
  }
  const name = provider.trim();
  return name === '' || name === PAYMENT_PROVIDER_TEST;
}
