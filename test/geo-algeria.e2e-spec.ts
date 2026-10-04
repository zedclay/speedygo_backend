import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { E2E_BRANCH_GEO } from './helpers/e2e-branch-geo';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type BranchBody = {
  id: string;
  wilayaCode: string | null;
  communeId: number | null;
  wilayaNameFr: string | null;
  communeNameFr: string | null;
  addressText: string;
};

describe('Algeria geo catalogue + branch location (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let redis: RedisService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sender = app.get(OTP_SENDER);
    redis = app.get(RedisService);
    const leftover = await redis.getClient().keys('auth:test:*');
    if (leftover.length > 0) {
      await redis.getClient().del(...leftover);
    }
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
        deviceName: 'geo-e2e',
      });
    expect(verified.status).toBe(200);
    return (verified.body as TokenBody).accessToken;
  }

  it('lists 69 wilayas and communes for Alger including search', async () => {
    const token = await authenticate('+213555010001');
    const server = app.getHttpServer();
    const wilayas = await request(server)
      .get('/api/v1/geo/wilayas')
      .set('Authorization', `Bearer ${token}`);
    expect(wilayas.status).toBe(200);
    const list = (wilayas.body as { wilayas: Array<{ code: string }> })
      .wilayas;
    expect(list).toHaveLength(69);
    expect(list[0]?.code).toBe('01');
    expect(list.some((w) => w.code === '16')).toBe(true);

    const communes = await request(server)
      .get('/api/v1/geo/wilayas/16/communes')
      .set('Authorization', `Bearer ${token}`);
    expect(communes.status).toBe(200);
    const communeList = (
      communes.body as { communes: Array<{ id: number; nameFr: string }> }
    ).communes;
    expect(communeList.length).toBeGreaterThan(50);
    expect(communeList.some((c) => c.id === 556)).toBe(true);

    const searched = await request(server)
      .get('/api/v1/geo/wilayas/16/communes')
      .query({ q: 'Centre' })
      .set('Authorization', `Bearer ${token}`);
    expect(searched.status).toBe(200);
    const hits = (
      searched.body as { communes: Array<{ id: number }> }
    ).communes;
    expect(hits.some((c) => c.id === 556)).toBe(true);

    const missing = await request(server)
      .get('/api/v1/geo/wilayas/99/communes')
      .set('Authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);
    expect((missing.body as ErrorBody).error.code).toBe('GEO_WILAYA_NOT_FOUND');
  });

  it('persists wilaya/commune on create, rejects mismatch, preserves legacy PATCH', async () => {
    const token = await authenticate('+213555010002');
    const server = app.getHttpServer();
    const profile = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Geo Fixture Merchant' });
    expect(profile.status).toBe(201);
    const merchantId = (profile.body as { merchantId: string }).merchantId;

    const mismatch = await request(server)
      .post(`/api/v1/merchant/${merchantId}/branches`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Bad pair',
        phone: '0550123456',
        addressText: 'Rue Test',
        latitude: 36.75,
        longitude: 3.05,
        wilayaCode: '16',
        communeId: 1, // Adrar commune — belongs to wilaya 01
      });
    expect(mismatch.status).toBe(400);
    expect((mismatch.body as ErrorBody).error.code).toBe(
      'GEO_COMMUNE_WILAYA_MISMATCH',
    );

    const created = await request(server)
      .post(`/api/v1/merchant/${merchantId}/branches`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Geo Branch',
        phone: '0550123456',
        addressText: '12 Rue Didouche Mourad',
        latitude: 36.753,
        longitude: 3.058,
        ...E2E_BRANCH_GEO,
      });
    expect(created.status).toBe(201);
    const body = created.body as BranchBody;
    expect(body.wilayaCode).toBe('16');
    expect(body.communeId).toBe(556);
    expect(body.wilayaNameFr).toBe('Alger');
    expect(body.communeNameFr).toBe('Alger Centre');
    expect(body.addressText).toBe('12 Rue Didouche Mourad');

    const phoneOnly = await request(server)
      .patch(`/api/v1/merchant/${merchantId}/branches/${body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '0550999888' });
    expect(phoneOnly.status).toBe(200);
    const afterPhone = phoneOnly.body as BranchBody;
    expect(afterPhone.wilayaCode).toBe('16');
    expect(afterPhone.communeId).toBe(556);
    expect(afterPhone.addressText).toBe('12 Rue Didouche Mourad');

    const reopen = await request(server)
      .get('/api/v1/merchant/me')
      .set('Authorization', `Bearer ${token}`);
    expect(reopen.status).toBe(200);
    const memberships = (
      reopen.body as {
        memberships: Array<{ branches: BranchBody[] }>;
      }
    ).memberships;
    const restored = memberships[0]?.branches.find((b) => b.id === body.id);
    expect(restored?.wilayaCode).toBe('16');
    expect(restored?.communeId).toBe(556);
    expect(restored?.wilayaNameFr).toBe('Alger');
    expect(restored?.communeNameFr).toBe('Alger Centre');
  });
});
