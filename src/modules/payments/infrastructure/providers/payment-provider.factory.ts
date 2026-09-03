import {
  PAYMENT_PROVIDER_CHARGILY,
  PAYMENT_PROVIDER_TEST,
} from '../../domain/payment.policy';
import type { PaymentProvider } from '../../domain/ports/payment-provider.port';
import {
  ChargilyPaymentProvider,
  type ChargilyProviderConfig,
} from './chargily-payment.provider';
import type { ChargilyHttpClient } from './chargily-http.client';
import { TestPaymentProvider } from './test-payment.provider';
import { UnconfiguredPaymentProvider } from './unconfigured-payment.provider';

export type PaymentProviderFactoryInput = {
  nodeEnv: string;
  provider: string;
  testWebhookSecret: string;
  chargilyHttp: ChargilyHttpClient | null;
  chargily: ChargilyProviderConfig;
};

export function createConfiguredPaymentProvider(
  input: PaymentProviderFactoryInput,
): PaymentProvider {
  const name = input.provider.trim();
  if (input.nodeEnv === 'production') {
    if (name === PAYMENT_PROVIDER_CHARGILY && input.chargilyHttp) {
      return new ChargilyPaymentProvider(input.chargilyHttp, input.chargily);
    }
    return new UnconfiguredPaymentProvider();
  }
  if (name === '' || name === PAYMENT_PROVIDER_TEST) {
    return new TestPaymentProvider(input.testWebhookSecret);
  }
  if (name === PAYMENT_PROVIDER_CHARGILY && input.chargilyHttp) {
    return new ChargilyPaymentProvider(input.chargilyHttp, input.chargily);
  }
  return new UnconfiguredPaymentProvider();
}
