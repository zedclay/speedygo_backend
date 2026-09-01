import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { PrismaService } from '../src/infrastructure/database/database.module';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';

type TokenBody = {
  accessToken: string;
  refreshToken: string;
};

type ErrorBody = { error: { code: string; message: string } };

type MeBody = {
  customerProfileExists: boolean;
  profileComplete: boolean;
  addressReady: boolean;
  profile: { id: string; fullName: string; avatarUrl: string | null } | null;
  addresses: Array<{
    id: string;
    label: string;
    addressText: string;
    isDefault: boolean;
    latitude: number;
    longitude: number;
  }>;
  defaultAddressId: string | null;
};

type ProfileBody = { id: string; fullName: string; avatarUrl: string | null };
type AddressBody = {
  id: string;
  label: string;
  addressText: string;
  isDefault: boolean;
};

const ACCOUNT_INJECTION = '33333333-3333-7333-8333-333333333333';

describe('Customer onboarding (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;

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
        platform: 'ios',
        appVersion: '1.0.0',
        deviceName: 'customer-e2e',
      });
    expect(verified.status).toBe(200);
    return (verified.body as TokenBody).accessToken;
  }

  async function cleanupByPhone(phoneE164: string) {
    const account = await prisma
      .getDb()
      .orm.public.Account.where({ phone: phoneE164 })
      .first();
    if (!account) {
      return;
    }
    const profile = await prisma
      .getDb()
      .orm.public.CustomerProfile.where({ accountId: account.id })
      .first();
    if (profile) {
      const addresses = await prisma
        .getDb()
        .orm.public.Address.where({ customerId: profile.id })
        .all();
      for (const address of addresses) {
        await prisma
          .getDb()
          .orm.public.Address.where({ id: address.id })
          .delete();
      }
      await prisma
        .getDb()
        .orm.public.CustomerProfile.where({ id: profile.id })
        .delete();
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
    await prisma.getDb().orm.public.Account.where({ id: account.id }).delete();
  }

  it('onboards a customer, manages addresses, and isolates ownership', async () => {
    const server = app.getHttpServer();
    const phoneA = `0553${Date.now().toString().slice(-6)}`;
    const phoneB = `0554${Date.now().toString().slice(-6)}`;
    let e164A: string | null = null;
    let e164B: string | null = null;

    try {
      const tokenA = await authenticate(phoneA);
      const tokenB = await authenticate(phoneB);

      const authMe = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokenA}`);
      e164A = (authMe.body as { account: { phone: string } }).account.phone;
      const authMeB = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokenB}`);
      e164B = (authMeB.body as { account: { phone: string } }).account.phone;

      const absent = await request(server)
        .get('/api/v1/customer/me')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(absent.status).toBe(200);
      const absentBody = absent.body as MeBody;
      expect(absentBody.customerProfileExists).toBe(false);
      expect(absentBody.profile).toBeNull();
      expect(absentBody.addresses).toEqual([]);

      const created = await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: '  Customer A  ', accountId: ACCOUNT_INJECTION });
      expect(created.status).toBe(400);

      const createdOk = await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: '  Customer A  ' });
      expect(createdOk.status).toBe(201);
      const profile = createdOk.body as ProfileBody;
      expect(profile.fullName).toBe('Customer A');
      expect(profile.avatarUrl).toBeNull();
      expect(profile).not.toHaveProperty('accountId');

      const avatarRejected = await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: 'Nope', avatarUrl: 'https://cdn.example/a.png' });
      expect(avatarRejected.status).toBe(400);

      const phoneRejected = await request(server)
        .patch('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ phone: '+213550000000' });
      expect(phoneRejected.status).toBe(400);

      const emailRejected = await request(server)
        .patch('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ email: 'ada@example.com' });
      expect(emailRejected.status).toBe(400);

      const avatarPatchRejected = await request(server)
        .patch('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          fullName: 'Customer A',
          avatarUrl: 'https://cdn.example/a.png',
        });
      expect(avatarPatchRejected.status).toBe(400);

      const duplicate = await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: 'Again' });
      expect(duplicate.status).toBe(409);
      expect((duplicate.body as ErrorBody).error.code).toBe(
        'CUSTOMER_PROFILE_ALREADY_EXISTS',
      );

      const meAfter = await request(server)
        .get('/api/v1/customer/me')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(meAfter.status).toBe(200);
      const meAfterBody = meAfter.body as MeBody;
      expect(meAfterBody.customerProfileExists).toBe(true);
      expect(meAfterBody.profileComplete).toBe(true);
      expect(meAfterBody.addressReady).toBe(false);

      const patched = await request(server)
        .patch('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: 'Customer A Updated', id: 'nope' });
      expect(patched.status).toBe(400);

      const patchedOk = await request(server)
        .patch('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: 'Customer A Updated' });
      expect(patchedOk.status).toBe(200);
      expect((patchedOk.body as ProfileBody).fullName).toBe(
        'Customer A Updated',
      );

      const addressA = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          label: 'Home',
          addressText: 'Street A',
          latitude: 36.75,
          longitude: 3.05,
          isDefault: false,
        });
      expect(addressA.status).toBe(201);
      const home = addressA.body as AddressBody;
      expect(home.isDefault).toBe(true);

      const tooLong = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          label: 'Too long',
          addressText: 'x'.repeat(501),
          latitude: 36.75,
          longitude: 3.05,
        });
      expect(tooLong.status).toBe(400);

      const meAfterFirstAddress = await request(server)
        .get('/api/v1/customer/me')
        .set('Authorization', `Bearer ${tokenA}`);
      expect((meAfterFirstAddress.body as MeBody).addressReady).toBe(true);
      expect((meAfterFirstAddress.body as MeBody).profileComplete).toBe(true);
      expect((meAfterFirstAddress.body as MeBody).defaultAddressId).toBe(
        home.id,
      );

      const addressB = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          label: 'Work',
          addressText: 'Street B',
          latitude: 36.76,
          longitude: 3.06,
          isDefault: true,
        });
      expect(addressB.status).toBe(201);
      const work = addressB.body as AddressBody;
      expect(work.isDefault).toBe(false);

      const afterSecond = await request(server)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(
        (afterSecond.body as { addresses: AddressBody[] }).addresses.filter(
          (row) => row.isDefault,
        ),
      ).toHaveLength(1);
      expect(
        (afterSecond.body as { addresses: AddressBody[] }).addresses.find(
          (row) => row.isDefault,
        )?.id,
      ).toBe(home.id);

      const defaultA = await request(server)
        .put(`/api/v1/customer/addresses/${home.id}/default`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(defaultA.status).toBe(200);
      expect((defaultA.body as AddressBody).isDefault).toBe(true);

      const defaultB = await request(server)
        .put(`/api/v1/customer/addresses/${work.id}/default`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(defaultB.status).toBe(200);

      const listed = await request(server)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(listed.status).toBe(200);
      const listedBody = listed.body as { addresses: AddressBody[] };
      expect(listedBody.addresses.filter((row) => row.isDefault)).toHaveLength(
        1,
      );
      expect(listedBody.addresses.find((row) => row.isDefault)?.id).toBe(
        work.id,
      );

      const updatedWork = await request(server)
        .patch(`/api/v1/customer/addresses/${work.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressText: 'Street B updated' });
      expect(updatedWork.status).toBe(200);
      expect((updatedWork.body as AddressBody).addressText).toBe(
        'Street B updated',
      );

      const deleted = await request(server)
        .delete(`/api/v1/customer/addresses/${home.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(deleted.status).toBe(200);

      const meReady = await request(server)
        .get('/api/v1/customer/me')
        .set('Authorization', `Bearer ${tokenA}`);
      const meReadyBody = meReady.body as MeBody;
      expect(meReadyBody.addresses).toHaveLength(1);
      expect(meReadyBody.defaultAddressId).toBe(work.id);
      expect(meReadyBody.addressReady).toBe(true);

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ fullName: 'Customer B' })
        .expect(201);

      const stealProfile = await request(server)
        .patch('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ fullName: 'Hijack A' });
      expect(stealProfile.status).toBe(200);
      expect((stealProfile.body as ProfileBody).fullName).toBe('Hijack A');

      const aStill = await request(server)
        .get('/api/v1/customer/me')
        .set('Authorization', `Bearer ${tokenA}`);
      expect((aStill.body as MeBody).profile?.fullName).toBe(
        'Customer A Updated',
      );

      const stealAddress = await request(server)
        .patch(`/api/v1/customer/addresses/${work.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ label: 'Stolen' });
      expect(stealAddress.status).toBe(404);
      expect((stealAddress.body as ErrorBody).error.code).toBe(
        'CUSTOMER_ADDRESS_NOT_FOUND',
      );

      const stealDefault = await request(server)
        .put(`/api/v1/customer/addresses/${work.id}/default`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(stealDefault.status).toBe(404);

      const stealDelete = await request(server)
        .delete(`/api/v1/customer/addresses/${work.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(stealDelete.status).toBe(404);

      const invalidCoords = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          label: 'Bad',
          addressText: 'Bad',
          latitude: 91,
          longitude: 3,
        });
      expect(invalidCoords.status).toBe(400);

      const invalidUuid = await request(server)
        .delete('/api/v1/customer/addresses/not-a-uuid')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(invalidUuid.status).toBe(400);

      const unauth = await request(server).get('/api/v1/customer/me');
      expect(unauth.status).toBe(401);
    } finally {
      if (e164A) {
        await cleanupByPhone(e164A);
      }
      if (e164B) {
        await cleanupByPhone(e164B);
      }
    }
  });

  it('does not auto-pick a default after deleting the default address', async () => {
    const server = app.getHttpServer();
    const phone = `0556${Date.now().toString().slice(-6)}`;
    let e164: string | null = null;
    try {
      const token = await authenticate(phone);
      const authMe = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      e164 = (authMe.body as { account: { phone: string } }).account.phone;

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Default Delete' })
        .expect(201);

      const first = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          label: 'A',
          addressText: 'A',
          latitude: 36.75,
          longitude: 3.05,
          isDefault: false,
        });
      const second = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          label: 'B',
          addressText: 'B',
          latitude: 36.76,
          longitude: 3.06,
        });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstId = (first.body as AddressBody).id;

      await request(server)
        .delete(`/api/v1/customer/addresses/${firstId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const me = await request(server)
        .get('/api/v1/customer/me')
        .set('Authorization', `Bearer ${token}`);
      const meBody = me.body as MeBody;
      expect(meBody.profileComplete).toBe(true);
      expect(meBody.addresses).toHaveLength(1);
      expect(meBody.addresses[0]?.isDefault).toBe(false);
      expect(meBody.defaultAddressId).toBeNull();
      expect(meBody.addressReady).toBe(false);
    } finally {
      if (e164) {
        await cleanupByPhone(e164);
      }
    }
  });

  it('keeps a single profile and a single default under concurrent writes', async () => {
    const server = app.getHttpServer();
    const phone = `0555${Date.now().toString().slice(-6)}`;
    let e164: string | null = null;
    try {
      const token = await authenticate(phone);
      const authMe = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      e164 = (authMe.body as { account: { phone: string } }).account.phone;

      const [first, second] = await Promise.all([
        request(server)
          .post('/api/v1/customer/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ fullName: 'Concurrent' }),
        request(server)
          .post('/api/v1/customer/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ fullName: 'Concurrent' }),
      ]);
      const createdCount = [first.status, second.status].filter(
        (status) => status === 201,
      ).length;
      const conflictCount = [first.status, second.status].filter(
        (status) => status === 409,
      ).length;
      expect(createdCount).toBe(1);
      expect(conflictCount).toBe(1);

      const [home, work] = await Promise.all([
        request(server)
          .post('/api/v1/customer/addresses')
          .set('Authorization', `Bearer ${token}`)
          .send({
            label: 'A',
            addressText: 'A',
            latitude: 36.75,
            longitude: 3.05,
            isDefault: false,
          }),
        request(server)
          .post('/api/v1/customer/addresses')
          .set('Authorization', `Bearer ${token}`)
          .send({
            label: 'B',
            addressText: 'B',
            latitude: 36.76,
            longitude: 3.06,
            isDefault: false,
          }),
      ]);
      expect(home.status).toBe(201);
      expect(work.status).toBe(201);
      const createdAddresses = [
        home.body as AddressBody,
        work.body as AddressBody,
      ];
      expect(createdAddresses.filter((row) => row.isDefault)).toHaveLength(1);
      const homeId = (home.body as AddressBody).id;
      const workId = (work.body as AddressBody).id;

      await Promise.all([
        request(server)
          .put(`/api/v1/customer/addresses/${homeId}/default`)
          .set('Authorization', `Bearer ${token}`),
        request(server)
          .put(`/api/v1/customer/addresses/${workId}/default`)
          .set('Authorization', `Bearer ${token}`),
      ]);

      const listed = await request(server)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${token}`);
      const defaults = (
        listed.body as { addresses: AddressBody[] }
      ).addresses.filter((row) => row.isDefault);
      expect(defaults).toHaveLength(1);
    } finally {
      if (e164) {
        await cleanupByPhone(e164);
      }
    }
  });
});
