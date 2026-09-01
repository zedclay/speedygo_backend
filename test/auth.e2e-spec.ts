import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { PrismaService } from '../src/infrastructure/database/database.module';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { pgNow, pgVarchar } from '../src/infrastructure/database/pg-values';

type TokenBody = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type MeBody = {
  account: {
    id: string;
    phone: string | null;
    email: string | null;
    status: string;
  };
  profiles: {
    hasCustomerProfile: boolean;
  };
};

type ErrorBody = { error: { code: string; message: string } };

type AcceptedBody = { accepted: boolean };

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  const phone = `0550${Date.now().toString().slice(-6)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sender = app.get(OTP_SENDER);
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    const leftover = await redis.getClient().keys('auth:test:*');
    if (leftover.length > 0) {
      await redis.getClient().del(...leftover);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function cleanupAccount(phoneE164: string) {
    const accounts = prisma.getDb().orm.public.Account;
    const account = await accounts.where({ phone: phoneE164 }).first();
    if (!account) {
      return;
    }
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
      await prisma.getDb().orm.public.Device.where({ id: device.id }).delete();
    }
    await accounts.where({ id: account.id }).delete();
  }

  it('otp verify, me, refresh rotation, logout', async () => {
    const server = app.getHttpServer();
    const requestOtp = await request(server)
      .post('/api/v1/auth/otp/request')
      .send({
        channel: 'PHONE',
        identifier: phone,
        purpose: 'AUTHENTICATE',
      });
    expect(requestOtp.status).toBe(200);
    const accepted = requestOtp.body as AcceptedBody;
    expect(accepted.accepted).toBe(true);
    expect(requestOtp.body).not.toHaveProperty('code');
    expect(sender.lastCode).toMatch(/^\d{6}$/);

    const verified = await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({
        channel: 'PHONE',
        identifier: phone,
        purpose: 'AUTHENTICATE',
        code: sender.lastCode,
        platform: 'ios',
        appVersion: '1.0.0',
        deviceName: 'e2e',
      });
    expect(verified.status).toBe(200);
    const tokens = verified.body as TokenBody;
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toContain('.');

    const me = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(me.status).toBe(200);
    const meBody = me.body as MeBody;
    expect(meBody.account.status).toBe('ACTIVE');
    expect(meBody.profiles.hasCustomerProfile).toBe(false);

    const rotated = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(rotated.status).toBe(200);
    const rotatedTokens = rotated.body as TokenBody;

    const secondRefresh = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotatedTokens.refreshToken });
    expect(secondRefresh.status).toBe(200);
    const secondTokens = secondRefresh.body as TokenBody;

    const logout = await request(server)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${secondTokens.accessToken}`);
    expect(logout.status).toBe(200);

    const afterLogout = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: secondTokens.refreshToken });
    expect(afterLogout.status).toBe(401);

    await cleanupAccount(meBody.account.phone as string);
  });

  it('rejects a wrong OTP', async () => {
    const server = app.getHttpServer();
    const identifier = `e2e.${Date.now()}@example.com`;
    await request(server).post('/api/v1/auth/otp/request').send({
      channel: 'EMAIL',
      identifier,
      purpose: 'AUTHENTICATE',
    });
    const failed = await request(server).post('/api/v1/auth/otp/verify').send({
      channel: 'EMAIL',
      identifier,
      purpose: 'AUTHENTICATE',
      code: '000000',
      platform: 'web',
      appVersion: '1.0.0',
    });
    expect(failed.status).toBe(401);
    expect((failed.body as ErrorBody).error.code).toMatch(/AUTH_/);
  });

  it('revokes the session when a rotated refresh token is reused', async () => {
    const server = app.getHttpServer();
    const identifier = `0552${Date.now().toString().slice(-6)}`;
    await request(server).post('/api/v1/auth/otp/request').send({
      channel: 'PHONE',
      identifier,
      purpose: 'AUTHENTICATE',
    });
    const verified = await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({
        channel: 'PHONE',
        identifier,
        purpose: 'AUTHENTICATE',
        code: sender.lastCode,
        platform: 'ios',
        appVersion: '1.0.0',
      });
    expect(verified.status).toBe(200);
    const tokens = verified.body as TokenBody;
    const rotated = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(rotated.status).toBe(200);
    const rotatedTokens = rotated.body as TokenBody;

    const reused = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(reused.status).toBe(401);

    const afterReuse = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotatedTokens.refreshToken });
    expect(afterReuse.status).toBe(401);

    await cleanupAccount(`+213${identifier.slice(1)}`);
  });

  it('rate-limits OTP resend', async () => {
    const server = app.getHttpServer();
    const identifier = `limit.${Date.now()}@example.com`;
    const first = await request(server).post('/api/v1/auth/otp/request').send({
      channel: 'EMAIL',
      identifier,
      purpose: 'AUTHENTICATE',
    });
    expect(first.status).toBe(200);
    const second = await request(server).post('/api/v1/auth/otp/request').send({
      channel: 'EMAIL',
      identifier,
      purpose: 'AUTHENTICATE',
    });
    expect(second.status).toBe(429);
    expect((second.body as ErrorBody).error.code).toBe('AUTH_RATE_LIMITED');
  });

  it('rejects a suspended account on protected routes and refresh', async () => {
    const server = app.getHttpServer();
    const identifier = `0551${Date.now().toString().slice(-6)}`;
    await request(server).post('/api/v1/auth/otp/request').send({
      channel: 'PHONE',
      identifier,
      purpose: 'AUTHENTICATE',
    });
    const verified = await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({
        channel: 'PHONE',
        identifier,
        purpose: 'AUTHENTICATE',
        code: sender.lastCode,
        platform: 'android',
        appVersion: '1.0.0',
      });
    expect(verified.status).toBe(200);
    const tokens = verified.body as TokenBody;
    const me = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    const meBody = me.body as MeBody;
    await prisma
      .getDb()
      .orm.public.Account.where({ id: meBody.account.id })
      .update({
        status: pgVarchar<64>('SUSPENDED'),
        updatedAt: pgNow(),
      });
    const sessionId = tokens.refreshToken.split('.')[0] ?? '';
    await redis.getClient().del(`auth:test:sess:${sessionId}`);

    const blocked = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(blocked.status).toBe(403);
    expect((blocked.body as ErrorBody).error.code).toBe(
      'AUTH_ACCOUNT_SUSPENDED',
    );

    const refresh = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(refresh.status).toBe(403);

    await cleanupAccount(meBody.account.phone as string);
  });
});
