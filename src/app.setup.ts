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
      'SpeedyGo backend. Authentication, Customer Onboarding, Merchant Foundation, and Catalog Foundation v1.0.',
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
