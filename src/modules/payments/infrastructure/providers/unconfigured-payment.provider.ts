import { paymentProviderConfigurationInvalid } from '../../domain/payment.errors';
import type { PaymentProvider } from '../../domain/ports/payment-provider.port';
import type {
  ProviderCheckoutSnapshot,
  ProviderCreateInput,
  ProviderSession,
  ProviderWebhookEvent,
} from '../../domain/payment.types';

export class UnconfiguredPaymentProvider implements PaymentProvider {
  readonly name = 'unconfigured';

  createPayment(_input: ProviderCreateInput): Promise<ProviderSession> {
    return Promise.reject(paymentProviderConfigurationInvalid());
  }

  verifyWebhook(_rawBody: Buffer, _signature: string | undefined): boolean {
    return false;
  }

  parseWebhook(_rawBody: Buffer): ProviderWebhookEvent {
    throw paymentProviderConfigurationInvalid();
  }

  queryPayment(): Promise<ProviderCheckoutSnapshot | null> {
    return Promise.resolve(null);
  }
}
