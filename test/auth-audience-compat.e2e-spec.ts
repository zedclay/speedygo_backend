import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  assertSafeE2eDatabaseUrl,
  resolveE2eDatabaseUrl,
} from '../src/config/e2e-database-safety';
import { PrismaService } from '../src/infrastructure/database/database.module';
import { normalizeIdentifier } from '../src/modules/auth/domain/identity';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { reconcileIsolatedAuthAudienceDb } from '../src/modules/auth/infrastructure/session-audience.schema';
import { TokenService } from '../src/modules/auth/infrastructure/token/token.service';

type TokenBody = {
  accessToken: string;
  refreshToken: string;
};

describe('Auth audience compatibility (enforce off)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let tokens: TokenService;
  const previousEnforce = process.env.AUTH_AUDIENCE_ENFORCE;
  const phone = `0563${Date.now().toString().slice(-6)}`;

  beforeAll(async () => {
    delete process.env.AUTH_AUDIENCE_ENFORCE;
    const databaseUrl = resolveE2eDatabaseUrl(process.env);
    assertSafeE2eDatabaseUrl(databaseUrl);
    reconcileIsolatedAuthAudienceDb(databaseUrl);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sender = app.get(OTP_SENDER);
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    const e164 = normalizeIdentifier('PHONE', phone, 'DZ');
    const account = await prisma
      .getDb()
      .orm.public.Account.where({ phone: e164 })
      .first();
    if (account) {
      const sessions = await prisma
        .getDb()
        .orm.public.Session.where({ accountId: account.id })
        .all();
      for (const session of sessions) {
        await prisma
          .getDb()
          .orm.public.Session.where({ id: session.id })
          .delete();
      }
      const devices = await prisma
        .getDb()
        .orm.public.Device.where({ accountId: account.id })
        .all();
      for (const device of devices) {
        await prisma
          .getDb()
          .orm.public.Device.where({ id: device.id })
          .delete();
      }
      await prisma.getDb().orm.public.Account.where({ id: account.id }).delete();
    }
    await app.close();
    if (previousEnforce === undefined) {
      delete process.env.AUTH_AUDIENCE_ENFORCE;
    } else {
      process.env.AUTH_AUDIENCE_ENFORCE = previousEnforce;
    }
  });

  it('accepts legacy clients without X-SpeedyGo-App and tokens without aud', async () => {
    const server = app.getHttpServer();
    const requested = await request(server)
      .post('/api/v1/auth/otp/request')
      .send({
        channel: 'PHONE',
        identifier: phone,
        purpose: 'AUTHENTICATE',
      });
    expect(requested.status).toBe(200);

    const verified = await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({
        channel: 'PHONE',
        identifier: phone,
        purpose: 'AUTHENTICATE',
        code: sender.lastCode,
        platform: 'ios',
        appVersion: '1.0.0',
      });
    expect(verified.status).toBe(200);
    const pair = verified.body as TokenBody;

    const me = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${pair.accessToken}`);
    expect(me.status).toBe(200);

    const claims = tokens.verifyAccessToken(pair.accessToken);
    expect(claims.aud).toBeUndefined();
    const legacy = tokens.signAccessToken(claims.sub, claims.sid);
    const legacyMe = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${legacy}`);
    expect(legacyMe.status).toBe(200);

    const other = `0564${Date.now().toString().slice(-6)}`;
    const withHeader = await request(server)
      .post('/api/v1/auth/otp/request')
      .set('X-SpeedyGo-App', 'CUSTOMER')
      .send({
        channel: 'PHONE',
        identifier: other,
        purpose: 'AUTHENTICATE',
      });
    expect(withHeader.status).toBe(200);
  });
});
