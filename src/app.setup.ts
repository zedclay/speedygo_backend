import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { API_GLOBAL_PREFIX } from './common/constants/api.constants';
import { AuthExceptionFilter } from './common/filters/auth-exception.filter';
import { assertAuthSecurityConfig } from './config/auth-config.validation';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  assertAuthSecurityConfig({
    nodeEnv: config.get<string>('nodeEnv', 'development'),
    jwtAccessSecret: config.get<string>('auth.jwtAccessSecret', ''),
    otpHmacSecret: config.get<string>('auth.otpHmacSecret', ''),
    otpTransport: config.get<string>('auth.otpTransport', 'disabled'),
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
      'SpeedyGo backend. Authentication, Customer Onboarding, Merchant, Catalog, Cart, Checkout, and Order Foundation v1.0. Checkout Preview is stateless and non-reserving. Order creation requires Customer-confirmed expectedMerchandiseSubtotalMinor, expectedDeliveryFeeMinor, and expectedCustomerTotalMinor (comparison-only; expectedCustomerTotalMinor maps to customerPayableMinor). The Backend recalculates all authoritative amounts. Price or Delivery Fee changes return 409 ORDER_RECONFIRMATION_REQUIRED and persist nothing. Payment method is selected at Order creation (COD or ELECTRONIC) and stored on Payment PENDING. No PaymentTransaction, COD collection, Delivery, or Merchant workflow is created. Amounts are integer minor units. Historical Order prices do not change with Catalog.',
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
