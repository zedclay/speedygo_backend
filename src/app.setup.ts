import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { API_GLOBAL_PREFIX } from './common/constants/api.constants';
import { AuthExceptionFilter } from './common/filters/auth-exception.filter';
import { assertAuthSecurityConfig } from './config/auth-config.validation';
import { assertCorsConfig } from './config/cors-config.validation';
import { createHttpCorsOptions } from './config/cors.policy';
import { assertDriverDeliveryConfig } from './config/driver-delivery-config.validation';
import { assertMatchingConfig } from './config/matching-config.validation';
import { assertPaymentConfig } from './config/payment-config.validation';
import { assertTrackingConfig } from './config/tracking-config.validation';
import { storageConfigInvalid } from './infrastructure/storage/domain/storage.errors';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('nodeEnv', 'development');
  assertStorageRuntimeConfig(config);
  const cors = assertCorsConfig({
    nodeEnv,
    allowedOriginsEnv: config.get<string | undefined>('corsAllowedOrigins'),
  });
  new Logger('CorsPolicy').log(
    `CORS enabled originCount=${cors.originCount} env=${nodeEnv}`,
  );
  assertAuthSecurityConfig({
    nodeEnv,
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
  app.enableCors(createHttpCorsOptions());
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

function assertStorageRuntimeConfig(config: ConfigService): void {
  const nodeEnv = config.get<string>('nodeEnv', 'development');
  const uploadsEnabled = config.get<boolean>('storage.uploadsEnabled', true);
  if (!uploadsEnabled) {
    return;
  }
  const driver = config.get<string>('storage.driver', 'local');
  if (nodeEnv === 'production') {
    if (driver === 'local') {
      throw storageConfigInvalid(
        'Production must not use local disk object storage (set STORAGE_DRIVER=s3)',
      );
    }
    if (driver !== 's3') {
      throw storageConfigInvalid(`Unknown STORAGE_DRIVER: ${driver}`);
    }
    const bucket = config.get<string>('storage.s3.bucket', '');
    const region = config.get<string>('storage.s3.region', '');
    const accessKeyId = config.get<string>('storage.s3.accessKeyId', '');
    const secretAccessKey = config.get<string>(
      'storage.s3.secretAccessKey',
      '',
    );
    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      throw storageConfigInvalid(
        'Production S3 storage requires STORAGE_S3_BUCKET, STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY',
      );
    }
    if (!config.get<boolean>('storage.malwareScanRequired', false)) {
      throw storageConfigInvalid(
        'Production uploads require STORAGE_MALWARE_SCAN_REQUIRED=true',
      );
    }
    if (config.get<string>('storage.malwareScannerDriver', '') !== 'clamav') {
      throw storageConfigInvalid(
        'Production uploads require STORAGE_MALWARE_SCANNER_DRIVER=clamav',
      );
    }
    return;
  }
  if (driver === 'local') {
    const localRoot = config.get<string>('storage.localRoot', '');
    if (!localRoot.trim()) {
      throw storageConfigInvalid(
        'STORAGE_LOCAL_ROOT is required when STORAGE_DRIVER=local',
      );
    }
  }
}
