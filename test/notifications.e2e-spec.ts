import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createUuidV7 } from '../src/common/utils/uuid-v7';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { PrismaService } from '../src/infrastructure/database/database.module';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { NotificationService } from '../src/modules/notifications/application/notification.service';
import { NotificationRecoveryService } from '../src/modules/notifications/application/notification-recovery.service';
import {
  NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
  NOTIFICATION_TYPE_SETTLEMENT_FINALIZED,
} from '../src/modules/notifications/domain/notification.types';

type TokenBody = { accessToken: string };
type AuthMeBody = { account: { id: string; phone: string } };
type ListBody = {
  items: Array<{
    id: string;
    title: string;
    read: boolean;
    type: string;
    sourceId: string;
  }>;
  total: number;
  unreadCount: number;
  limit: number;
  offset: number;
};

describe('Notifications Foundation (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let notifications: NotificationService;
  let recovery: NotificationRecoveryService;

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
    notifications = app.get(NotificationService);
    recovery = app.get(NotificationRecoveryService);
    for (const pattern of ['auth:test:*']) {
      const keys = await redis.getClient().keys(pattern);
      if (keys.length > 0) {
        await redis.getClient().del(...keys);
      }
    }
    void prisma;
  });

  afterAll(async () => {
    await app.close();
  });

  async function authenticate(phone: string): Promise<string> {
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
        deviceName: 'notif-e2e',
      });
    expect(verified.status).toBe(200);
    return (verified.body as TokenBody).accessToken;
  }

  async function authMe(token: string): Promise<AuthMeBody['account']> {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return (response.body as AuthMeBody).account;
  }

  it('lists own inbox, dedupes source emits, blocks foreign mark-read, registers device token', async () => {
    const tokenA = await authenticate('+213555010101');
    const tokenB = await authenticate('+213555010102');
    const accountA = await authMe(tokenA);
    const accountB = await authMe(tokenB);
    const paymentId = createUuidV7();
    const settlementId = createUuidV7();

    const first = await notifications.emitLogical({
      type: NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
      sourceId: paymentId,
      accountId: accountA.id,
      title: 'Payment successful',
      body: 'Payment for order sgo_test succeeded.',
    });
    expect(first.created).toBe(true);
    const replay = await notifications.emitLogical({
      type: NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
      sourceId: paymentId,
      accountId: accountA.id,
      title: 'Payment successful',
      body: 'Payment for order sgo_test succeeded.',
    });
    expect(replay.created).toBe(false);
    expect(replay.notification.id).toBe(first.notification.id);

    await notifications.emitLogical({
      type: NOTIFICATION_TYPE_SETTLEMENT_FINALIZED,
      sourceId: settlementId,
      accountId: accountA.id,
      title: 'Settlement finalized',
      body: 'A merchant settlement statement is available. This is not a bank payout confirmation.',
    });

    const listed = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .query({ limit: 20, offset: 0 })
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listed.status).toBe(200);
    const body = listed.body as ListBody;
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.unreadCount).toBeGreaterThanOrEqual(2);
    const paymentRows = body.items.filter(
      (row) => row.type === 'PAYMENT_SUCCEEDED' && row.sourceId === paymentId,
    );
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0].id).toBe(first.notification.id);

    const foreignList = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(foreignList.status).toBe(200);
    expect(
      (foreignList.body as ListBody).items.some(
        (row) => row.id === first.notification.id,
      ),
    ).toBe(false);

    const markForeign = await request(app.getHttpServer())
      .post(`/api/v1/notifications/${first.notification.id}/read`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(markForeign.status).toBe(404);

    const markOwn = await request(app.getHttpServer())
      .post(`/api/v1/notifications/${first.notification.id}/read`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(markOwn.status).toBe(200);
    expect((markOwn.body as { read: boolean }).read).toBe(true);

    const markOwnAgain = await request(app.getHttpServer())
      .post(`/api/v1/notifications/${first.notification.id}/read`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(markOwnAgain.status).toBe(200);
    expect((markOwnAgain.body as { read: boolean }).read).toBe(true);

    const unread = await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(unread.status).toBe(200);
    expect(typeof (unread.body as { unreadCount: number }).unreadCount).toBe(
      'number',
    );

    const register = await request(app.getHttpServer())
      .put('/api/v1/notifications/device-tokens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        token: `fcm-test-token-${accountA.id}`,
        platform: 'android',
      });
    expect(register.status).toBe(200);
    expect((register.body as { active: boolean }).active).toBe(true);

    const deactivate = await request(app.getHttpServer())
      .delete('/api/v1/notifications/device-tokens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ token: `fcm-test-token-${accountA.id}` });
    expect(deactivate.status).toBe(200);
    expect((deactivate.body as { ok: boolean }).ok).toBe(true);

    void accountB;
  });

  it('does not expose public create, retry, or recovery endpoints', async () => {
    const token = await authenticate('+213555010103');
    const create = await request(app.getHttpServer())
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'x', body: 'y' });
    expect([404, 405]).toContain(create.status);

    const retry = await request(app.getHttpServer())
      .post(`/api/v1/notifications/${createUuidV7()}/retry`)
      .set('Authorization', `Bearer ${token}`);
    expect([404, 405]).toContain(retry.status);

    const recoverHttp = await request(app.getHttpServer())
      .post('/api/v1/notifications/recovery')
      .set('Authorization', `Bearer ${token}`);
    expect([404, 405]).toContain(recoverHttp.status);
  });

  it('runs bounded internal recovery without creating duplicates for existing intents', async () => {
    const token = await authenticate('+213555010104');
    const account = await authMe(token);
    const paymentId = createUuidV7();
    const first = await notifications.emitLogical({
      type: NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
      sourceId: paymentId,
      accountId: account.id,
      title: 'Payment successful',
      body: 'Payment for order sgo_recovery succeeded.',
    });
    expect(first.created).toBe(true);

    const [a, b] = await Promise.all([recovery.recover(), recovery.recover()]);
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    const listed = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${token}`);
    expect(listed.status).toBe(200);
    const paymentRows = (listed.body as ListBody).items.filter(
      (row) => row.type === 'PAYMENT_SUCCEEDED' && row.sourceId === paymentId,
    );
    expect(paymentRows).toHaveLength(1);

    const publicRecover = await request(app.getHttpServer())
      .post('/api/v1/notifications/recovery')
      .set('Authorization', `Bearer ${token}`);
    expect([404, 405]).toContain(publicRecover.status);
  });
});
