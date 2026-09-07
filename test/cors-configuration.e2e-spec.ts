import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_REQUEST_HEADERS,
  CORS_EXPOSED_RESPONSE_HEADERS,
  CORS_PREFLIGHT_MAX_AGE_SECONDS,
} from '../src/config/cors.policy';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { PrismaService } from '../src/infrastructure/database/database.module';
import {
  attachRedisIoAdapter,
  RedisIoAdapter,
} from '../src/infrastructure/realtime/redis-io.adapter';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { TRACKING_NAMESPACE } from '../src/modules/tracking/domain/tracking.events';
import { createUuidV7 } from '../src/common/utils/uuid-v7';
import { pgNow } from '../src/infrastructure/database/pg-values';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';

type TokenPair = { accessToken: string; refreshToken: string };
type ErrorBody = { error: { code: string; message: string } };

/** Must match test/setup-e2e-env.ts default CORS_ALLOWED_ORIGINS. */
const E2E_ALLOWED_ORIGIN = 'http://127.0.0.1:5173';

describe('P1-H Production-safe CORS Configuration (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let redisIo: RedisIoAdapter;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    redisIo = attachRedisIoAdapter(app);
    await app.listen(0);
    const server = app.getHttpServer() as {
      address: () => string | { port: number } | null;
    };
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    sender = app.get(OTP_SENDER);
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
  });

  afterAll(async () => {
    await redisIo.close();
    await app.close();
  });

  async function authenticate(phone: string): Promise<TokenPair> {
    const server = app.getHttpServer();
    await request(server).post('/api/v1/auth/otp/request').send({
      channel: 'PHONE',
      identifier: phone,
      purpose: 'AUTHENTICATE',
    });
    const verified = await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({
        channel: 'PHONE',
        identifier: phone,
        purpose: 'AUTHENTICATE',
        code: sender.lastCode,
        platform: 'android',
        appVersion: '1.0.0',
        deviceName: 'cors-e2e',
      });
    expect(verified.status).toBe(200);
    return verified.body as TokenPair;
  }

  async function cleanupByPhone(phoneE164: string): Promise<void> {
    const account = await prisma
      .getDb()
      .orm.public.Account.where({ phone: phoneE164 })
      .first();
    if (!account) {
      return;
    }
    for (const session of await prisma
      .getDb()
      .orm.public.Session.where({ accountId: account.id })
      .all()) {
      await prisma
        .getDb()
        .orm.public.Session.where({ id: session.id })
        .delete();
    }
    for (const device of await prisma
      .getDb()
      .orm.public.Device.where({ accountId: account.id })
      .all()) {
      await prisma.getDb().orm.public.Device.where({ id: device.id }).delete();
    }
    await deleteAccountNotificationArtifacts(prisma, account.id);
    await prisma.getDb().orm.public.Account.where({ id: account.id }).delete();
  }

  function expectNoCorsApproval(res: request.Response): void {
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    const bodyText = JSON.stringify(res.body ?? {});
    expect(bodyText).not.toContain(E2E_ALLOWED_ORIGIN);
    expect(bodyText).not.toMatch(/CORS_ALLOWED_ORIGINS/i);
  }

  it('approved Origin preflight returns exact CORS contract without credentials', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/auth/me')
      .set('Origin', E2E_ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(E2E_ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    expect(String(res.headers.vary ?? '').toLowerCase()).toContain('origin');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    const methods = String(res.headers['access-control-allow-methods'] ?? '');
    for (const method of CORS_ALLOWED_METHODS) {
      expect(methods.toUpperCase()).toContain(method);
    }
    const headers = String(
      res.headers['access-control-allow-headers'] ?? '',
    ).toLowerCase();
    for (const header of CORS_ALLOWED_REQUEST_HEADERS) {
      expect(headers).toContain(header.toLowerCase());
    }
    expect(Number(res.headers['access-control-max-age'])).toBe(
      CORS_PREFLIGHT_MAX_AGE_SECONDS,
    );
  });

  it('approved Origin authenticated request works and exposes Content-Disposition', async () => {
    const suffix = Date.now().toString().slice(-6);
    const phone = `0701${suffix}`;
    let e164: string | undefined;
    try {
      const tokens = await authenticate(phone);
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Origin', E2E_ALLOWED_ORIGIN)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(me.status).toBe(200);
      e164 = (me.body as { account: { phone: string } }).account.phone;
      expect(me.headers['access-control-allow-origin']).toBe(
        E2E_ALLOWED_ORIGIN,
      );
      expect(me.headers['access-control-allow-credentials']).toBeUndefined();

      const docProbe = await request(app.getHttpServer())
        .get(
          `/api/v1/admin/merchants/${createUuidV7()}/documents/${createUuidV7()}/content`,
        )
        .set('Origin', E2E_ALLOWED_ORIGIN)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(docProbe.status).not.toBe(500);
      expect(docProbe.headers['access-control-allow-origin']).toBe(
        E2E_ALLOWED_ORIGIN,
      );
      const exposed = String(
        docProbe.headers['access-control-expose-headers'] ?? '',
      ).toLowerCase();
      for (const header of CORS_EXPOSED_RESPONSE_HEADERS) {
        expect(exposed).toContain(header.toLowerCase());
      }
    } finally {
      if (e164) {
        await cleanupByPhone(e164);
      }
    }
  });

  it.each([
    ['https://evil.example', 'unrelated'],
    ['https://127.0.0.1.evil.test', 'deceptive suffix'],
    ['https://127.0.0.1:5173', 'wrong scheme'],
    ['http://127.0.0.1:5174', 'wrong port'],
    ['null', 'Origin null'],
  ])(
    'disallowed Origin (%s / %s) receives no CORS approval',
    async (origin) => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/auth/me')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization');
      expect(res.status).not.toBe(500);
      expectNoCorsApproval(res);

      const getRes = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Origin', origin);
      expect(getRes.status).not.toBe(500);
      expectNoCorsApproval(getRes);
    },
  );

  it('missing Origin preserves auth, health, and webhook signature path', async () => {
    const suffix = (Date.now() + 1).toString().slice(-6);
    const phone = `0702${suffix}`;
    let e164: string | undefined;
    try {
      const health = await request(app.getHttpServer()).get('/health');
      expect(health.status).toBe(200);
      expect(health.headers['access-control-allow-origin']).toBeUndefined();

      const denied = await request(app.getHttpServer()).get('/api/v1/auth/me');
      expect(denied.status).toBe(401);
      expect((denied.body as ErrorBody).error.code).toBeTruthy();

      const tokens = await authenticate(phone);
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(me.status).toBe(200);
      e164 = (me.body as { account: { phone: string } }).account.phone;

      const raw = JSON.stringify({ event: 'cors-probe' });
      const badSig = await request(app.getHttpServer())
        .post('/api/v1/payments/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('X-SpeedyGo-Signature', 'sha256=deadbeef')
        .send(raw);
      expect(badSig.status).toBe(401);
      expect((badSig.body as ErrorBody).error.code).toBe(
        'PAYMENT_WEBHOOK_INVALID_SIGNATURE',
      );

      const secret = process.env.PAYMENT_TEST_WEBHOOK_SECRET ?? '';
      const digest = createHmac('sha256', secret).update(raw).digest('hex');
      const signed = await request(app.getHttpServer())
        .post('/api/v1/payments/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('X-SpeedyGo-Signature', `sha256=${digest}`)
        .send(raw);
      // Signature may pass while payload is rejected by business rules — not CORS.
      expect(signed.status).not.toBe(500);
      expect(signed.headers['access-control-allow-origin']).toBeUndefined();
      if (signed.status === 401) {
        expect((signed.body as ErrorBody).error.code).not.toMatch(/CORS/i);
      }
    } finally {
      if (e164) {
        await cleanupByPhone(e164);
      }
    }
  });

  function connectRealtime(
    token: string,
    opts?: { origin?: string; omitOrigin?: boolean },
  ): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const extraHeaders: Record<string, string> = {};
      if (opts?.origin !== undefined) {
        extraHeaders.Origin = opts.origin;
      }
      const socket = io(`${baseUrl}${TRACKING_NAMESPACE}`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        ...(Object.keys(extraHeaders).length > 0
          ? { extraHeaders }
          : opts?.omitOrigin
            ? { extraHeaders: {} }
            : {}),
      });
      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error('socket connect timeout'));
      }, 5000);
      socket.on('connect', () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.on('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function expectConnectFail(token: string, origin: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}${TRACKING_NAMESPACE}`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        extraHeaders: { Origin: origin },
      });
      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error('expected connect_error'));
      }, 5000);
      socket.on('connect', () => {
        clearTimeout(timer);
        socket.disconnect();
        reject(new Error('unexpected connect'));
      });
      socket.on('connect_error', () => {
        clearTimeout(timer);
        socket.disconnect();
        resolve();
      });
    });
  }

  it('Socket.IO honors the same allowlist as HTTP', async () => {
    const suffix = (Date.now() + 2).toString().slice(-6);
    const phone = `0703${suffix}`;
    let e164: string | undefined;
    let socket: Socket | undefined;
    try {
      const tokens = await authenticate(phone);
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      e164 = (me.body as { account: { phone: string } }).account.phone;

      socket = await connectRealtime(tokens.accessToken, {
        origin: E2E_ALLOWED_ORIGIN,
      });
      expect(socket.connected).toBe(true);
      socket.disconnect();
      socket = undefined;

      await expectConnectFail(tokens.accessToken, 'https://evil.example');
      await expectConnectFail(tokens.accessToken, 'null');

      socket = await connectRealtime(tokens.accessToken, { omitOrigin: true });
      expect(socket.connected).toBe(true);
      socket.disconnect();
      socket = undefined;

      const sid = (
        JSON.parse(
          Buffer.from(tokens.accessToken.split('.')[1], 'base64url').toString(
            'utf8',
          ),
        ) as { sid: string }
      ).sid;
      await prisma
        .getDb()
        .orm.public.Session.where({ id: sid })
        .update({ revokedAt: pgNow() });
      await redis.getClient().del(`auth:test:sess:${sid}`);
      await expectConnectFail(tokens.accessToken, E2E_ALLOWED_ORIGIN);
    } finally {
      socket?.disconnect();
      if (e164) {
        await cleanupByPhone(e164);
      }
    }
  });
});
