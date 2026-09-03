import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { API_GLOBAL_PREFIX } from './common/constants/api.constants';
import { AuthExceptionFilter } from './common/filters/auth-exception.filter';
import { assertAuthSecurityConfig } from './config/auth-config.validation';
import { assertDriverDeliveryConfig } from './config/driver-delivery-config.validation';
import { assertMatchingConfig } from './config/matching-config.validation';
import { assertPaymentConfig } from './config/payment-config.validation';
import { assertTrackingConfig } from './config/tracking-config.validation';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  assertAuthSecurityConfig({
    nodeEnv: config.get<string>('nodeEnv', 'development'),
    jwtAccessSecret: config.get<string>('auth.jwtAccessSecret', ''),
    otpHmacSecret: config.get<string>('auth.otpHmacSecret', ''),
    otpTransport: config.get<string>('auth.otpTransport', 'disabled'),
  });
  assertMatchingConfig({
    locationMaxAgeMs: config.get<number>('matching.locationMaxAgeMs', 45_000),
    pickupRadiusMeters: config.get<number>('matching.pickupRadiusMeters', 5000),
    candidateLimit: config.get<number>('matching.candidateLimit', 20),
    offerTimeoutMs: config.get<number>('matching.offerTimeoutMs', 30_000),
    retryDelayMs: config.get<number>('matching.retryDelayMs', 15_000),
    recoveryIntervalMs: config.get<number>(
      'matching.recoveryIntervalMs',
      15_000,
    ),
    recoveryBatchSize: config.get<number>('matching.recoveryBatchSize', 50),
  });
  assertDriverDeliveryConfig({
    pickupRadiusMeters: config.get<number>(
      'driverDelivery.pickupRadiusMeters',
      300,
    ),
    dropoffRadiusMeters: config.get<number>(
      'driverDelivery.dropoffRadiusMeters',
      300,
    ),
  });
  assertPaymentConfig({
    nodeEnv: config.get<string>('nodeEnv', 'development'),
    provider: config.get<string>('payments.provider', ''),
    chargilySecretKey: config.get<string>('payments.chargilySecretKey', ''),
    chargilyMode: config.get<string>('payments.chargilyMode', ''),
    returnUrl: config.get<string>('payments.returnUrl', ''),
    cancelUrl: config.get<string>('payments.cancelUrl', ''),
    webhookUrl: config.get<string>('payments.webhookUrl', ''),
  });
  assertTrackingConfig({
    locationTtlMs: config.get<number>('tracking.locationTtlMs', 600_000),
    staleCleanupIntervalMs: config.get<number>(
      'tracking.staleCleanupIntervalMs',
      30_000,
    ),
    staleCleanupMaxAgeMs: config.get<number>(
      'tracking.staleCleanupMaxAgeMs',
      300_000,
    ),
    staleCleanupBatchSize: config.get<number>(
      'tracking.staleCleanupBatchSize',
      100,
    ),
    minUpdateIntervalMs: config.get<number>(
      'tracking.minUpdateIntervalMs',
      1000,
    ),
    authRevalidationIntervalMs: config.get<number>(
      'tracking.authRevalidationIntervalMs',
      15_000,
    ),
    locationMaxAgeMs: config.get<number>('matching.locationMaxAgeMs', 45_000),
  });

  app.use(helmet());
  app.enableCors();
  if (config.get<boolean>('auth.trustProxy')) {
    const http = app.getHttpAdapter();
    const instance = http.getInstance() as {
      set?: (k: string, v: unknown) => void;
    };
    instance.set?.('trust proxy', 1);
  }

  const globalPrefix = config.get<string>('apiGlobalPrefix', API_GLOBAL_PREFIX);
  app.setGlobalPrefix(globalPrefix, { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AuthExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SpeedyGo API')
    .setDescription(
      'SpeedyGo backend. Authentication, Customer Onboarding, Merchant, Catalog, Cart, Checkout, Order Foundation, Merchant Order Workflow v1.0, Delivery Foundation v1.0, Driver Foundation & Onboarding v1.0, Driver Matching v1.0, Realtime Tracking Foundation v1.0, Driver Delivery Workflow v1.0, and Payments Foundation v1.0. Matching start is internal. Live location uses the Matching DriverLocationStore. Tracking is assignment-authorized. Driver Delivery uses explicit current-assignment actions. Production electronic Payment is Chargily Pay V2. Amounts are integer minor units.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );
}
