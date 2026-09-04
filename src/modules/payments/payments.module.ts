import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  resolveChargilyMode,
  shouldUseTestPaymentProvider,
} from '../../config/payment-config.validation';
import { FinancialLedgerModule } from '../financial-ledger/financial-ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentService } from './application/payment.service';
import { PAYMENT_PROVIDER_CHARGILY } from './domain/payment.policy';
import { CHARGILY_HTTP, PAYMENT_PROVIDER } from './domain/payment.types';
import { PaymentRepository } from './infrastructure/payment.repository';
import {
  FetchChargilyHttpClient,
  type ChargilyHttpClient,
} from './infrastructure/providers/chargily-http.client';
import { chargilyBaseUrl } from './infrastructure/providers/chargily-payment.provider';
import { createConfiguredPaymentProvider } from './infrastructure/providers/payment-provider.factory';
import { CustomerPaymentController } from './presentation/http/customer-payment.controller';
import { PaymentWebhookController } from './presentation/http/payment-webhook.controller';

@Module({
  imports: [FinancialLedgerModule, NotificationsModule],
  controllers: [CustomerPaymentController, PaymentWebhookController],
  providers: [
    PaymentRepository,
    PaymentService,
    {
      provide: CHARGILY_HTTP,
      useFactory: (config: ConfigService): ChargilyHttpClient | null => {
        const provider = config.get<string>('payments.provider', '').trim();
        const nodeEnv = config.get<string>('nodeEnv', 'development');
        if (provider !== PAYMENT_PROVIDER_CHARGILY) {
          return null;
        }
        if (shouldUseTestPaymentProvider(nodeEnv, provider)) {
          return null;
        }
        const mode = resolveChargilyMode(
          nodeEnv,
          config.get<string>('payments.chargilyMode', ''),
        );
        return new FetchChargilyHttpClient({
          baseUrl: chargilyBaseUrl(mode),
          secretKey: config.get<string>('payments.chargilySecretKey', ''),
          timeoutMs: 15_000,
        });
      },
      inject: [ConfigService],
    },
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (
        config: ConfigService,
        chargilyHttp: ChargilyHttpClient | null,
      ) => {
        return createConfiguredPaymentProvider({
          nodeEnv: config.get<string>('nodeEnv', 'development'),
          provider: config.get<string>('payments.provider', ''),
          testWebhookSecret: config.get<string>(
            'payments.testWebhookSecret',
            '',
          ),
          chargilyHttp,
          chargily: {
            secretKey: config.get<string>('payments.chargilySecretKey', ''),
            returnUrl: config.get<string>('payments.returnUrl', ''),
            cancelUrl: config.get<string>('payments.cancelUrl', ''),
            webhookUrl: config.get<string>('payments.webhookUrl', ''),
            locale: config.get<string>('payments.chargilyLocale', 'ar'),
          },
        });
      },
      inject: [ConfigService, CHARGILY_HTTP],
    },
  ],
  exports: [PaymentService],
})
export class PaymentsModule {}
