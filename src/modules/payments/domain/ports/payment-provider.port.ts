import type {
  ProviderCheckoutSnapshot,
  ProviderCreateInput,
  ProviderSession,
  ProviderWebhookEvent,
} from '../payment.types';

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: ProviderCreateInput): Promise<ProviderSession>;
  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean;
  parseWebhook(rawBody: Buffer): ProviderWebhookEvent;
  queryPayment(input: {
    providerReference: string;
  }): Promise<ProviderCheckoutSnapshot | null>;
}
