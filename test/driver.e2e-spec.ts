import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';
import { configureApp } from '../src/app.setup';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { PrismaService } from '../src/infrastructure/database/database.module';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { pgDate } from '../src/infrastructure/database/pg-values';
import { DriverReviewService } from '../src/modules/drivers/application/driver-review.service';
import { DriverService } from '../src/modules/drivers/application/driver.service';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type MeBody = {
  driverProfileExists: boolean;
  profileComplete: boolean;
  identityDocumentComplete: boolean;
  drivingLicenseComplete: boolean;
  vehicleComplete: boolean;
  verificationSubmitted: boolean;
  verificationApproved: boolean;
  operationalReady: boolean;
  matchingEligible: boolean;
  profile: { id: string; verificationStatus: string } | null;
  documents: Array<{ type: string; present: boolean }>;
  vehicles: Array<{ id: string; plateNumber: string; status: string }>;
  availability: { status: string } | null;
};

describe('Driver foundation (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let review: DriverReviewService;
  let drivers: DriverService;

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
    review = app.get(DriverReviewService);
    drivers = app.get(DriverService);
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
        deviceName: 'driver-e2e',
      });
    expect(verified.status).toBe(200);
    return (verified.body as TokenBody).accessToken;
  }

  async function cleanupByPhone(phoneE164: string): Promise<void> {
    const account = await prisma
      .getDb()
      .orm.public.Account.where({ phone: phoneE164 })
      .first();
    if (!account) {
      return;
    }
    const profile = await prisma
      .getDb()
      .orm.public.DriverProfile.where({ accountId: account.id })
      .first();
    if (profile) {
      const docs = await prisma
        .getDb()
        .orm.public.DriverDocument.where({ driverId: profile.id })
        .all();
      for (const doc of docs) {
        await prisma
          .getDb()
          .orm.public.DriverDocument.where({ id: doc.id })
          .delete();
      }
      const vehicles = await prisma
        .getDb()
        .orm.public.Vehicle.where({ driverId: profile.id })
        .all();
      for (const vehicle of vehicles) {
        await prisma
          .getDb()
          .orm.public.Vehicle.where({ id: vehicle.id })
          .delete();
      }
      await prisma
        .getDb()
        .orm.public.DriverProfile.where({ id: profile.id })
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
    await deleteAccountNotificationArtifacts(prisma, account.id);

    await prisma.getDb().orm.public.Account.where({ id: account.id }).delete();
  }

  it('onboards a Driver, rejects incomplete submit, and blocks self-approval', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      driver: `0594${suffix}`,
      other: `0595${suffix}`,
    };
    const e164: string[] = [];
    try {
      const token = await authenticate(phones.driver);
      const other = await authenticate(phones.other);
      const meAuth = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      e164.push((meAuth.body as { account: { phone: string } }).account.phone);
      const otherAuth = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${other}`);
      e164.push(
        (otherAuth.body as { account: { phone: string } }).account.phone,
      );

      const missing = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${token}`);
      expect(missing.status).toBe(200);
      expect((missing.body as MeBody).driverProfileExists).toBe(false);

      const injected = await request(server)
        .post('/api/v1/driver/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: 'Ada Driver',
          verificationStatus: 'APPROVED',
          approvedAt: '2026-01-01T00:00:00.000Z',
        });
      expect(injected.status).toBe(400);

      const created = await request(server)
        .post('/api/v1/driver/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Ada Driver' });
      expect(created.status).toBe(201);
      expect(
        (created.body as { verificationStatus: string }).verificationStatus,
      ).toBe('UNVERIFIED');

      const duplicate = await request(server)
        .post('/api/v1/driver/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Ada Driver' });
      expect(duplicate.status).toBe(409);
      expect((duplicate.body as ErrorBody).error.code).toBe(
        'DRIVER_PROFILE_ALREADY_EXISTS',
      );

      const incomplete = await request(server)
        .post('/api/v1/driver/verification/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(incomplete.status).toBe(409);
      expect((incomplete.body as ErrorBody).error.code).toBe(
        'DRIVER_DOCUMENT_REQUIRED',
      );

      await request(server)
        .put('/api/v1/driver/documents/IDENTITY')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      await request(server)
        .put('/api/v1/driver/documents/DRIVING_LICENSE')
        .set('Authorization', `Bearer ${token}`)
        .send({ expiryDate: '2099-12-31' });
      const vehicle = await request(server)
        .post('/api/v1/driver/vehicles')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'MOTORCYCLE',
          plateNumber: `e2e ${suffix}`,
          model: 'NMAX',
          color: 'Black',
        });
      expect(vehicle.status).toBe(201);

      const ready = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${token}`);
      const readyBody = ready.body as MeBody;
      expect(readyBody.profileComplete).toBe(true);
      expect(readyBody.identityDocumentComplete).toBe(true);
      expect(readyBody.drivingLicenseComplete).toBe(true);
      expect(readyBody.vehicleComplete).toBe(true);
      expect(JSON.stringify(readyBody)).not.toContain('sg-object:');
      expect(readyBody.documents[0]).not.toHaveProperty('fileUrl');

      const submitted = await request(server)
        .post('/api/v1/driver/verification/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(submitted.status).toBe(200);
      expect((submitted.body as MeBody).profile?.verificationStatus).toBe(
        'PENDING_REVIEW',
      );

      const repeat = await request(server)
        .post('/api/v1/driver/verification/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(repeat.status).toBe(409);

      const unapprovedOnline = await request(server)
        .post('/api/v1/driver/availability/go-online')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(unapprovedOnline.status).toBe(409);

      const foreignUpdate = await request(server)
        .patch('/api/v1/driver/profile')
        .set('Authorization', `Bearer ${other}`)
        .send({ fullName: 'Eve' });
      expect(foreignUpdate.status).toBe(404);
      const foreignVehicle = await request(server)
        .patch(`/api/v1/driver/vehicles/${(vehicle.body as { id: string }).id}`)
        .set('Authorization', `Bearer ${other}`)
        .send({ color: 'Red' });
      expect(foreignVehicle.status).toBe(404);
      const foreignSubmit = await request(server)
        .post('/api/v1/driver/verification/submit')
        .set('Authorization', `Bearer ${other}`)
        .send({});
      expect(foreignSubmit.status).toBe(404);
      const otherMe = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${other}`);
      expect((otherMe.body as MeBody).driverProfileExists).toBe(false);
      expect(JSON.stringify(otherMe.body)).not.toContain('Ada Driver');

      const deliveries = await request(server)
        .get('/api/v1/driver/deliveries')
        .set('Authorization', `Bearer ${token}`);
      expect(deliveries.status).toBe(404);
      const customerDelivery = await request(server)
        .get(
          '/api/v1/customer/orders/11111111-1111-7111-8111-111111111111/delivery',
        )
        .set('Authorization', `Bearer ${token}`);
      expect(customerDelivery.status).toBe(404);
      const merchantDelivery = await request(server)
        .get(
          '/api/v1/merchant/11111111-1111-7111-8111-111111111111/orders/11111111-1111-7111-8111-111111111111/delivery',
        )
        .set('Authorization', `Bearer ${token}`);
      expect(merchantDelivery.status).toBe(404);
      const orderDelivery = await request(server)
        .get(
          '/api/v1/driver/orders/11111111-1111-7111-8111-111111111111/delivery',
        )
        .set('Authorization', `Bearer ${token}`);
      expect(orderDelivery.status).toBe(404);

      const driverId = (submitted.body as MeBody).profile!.id;
      await review.approve(driverId);
      const approved = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${token}`);
      expect((approved.body as MeBody).profile?.verificationStatus).toBe(
        'APPROVED',
      );
      expect((approved.body as MeBody).operationalReady).toBe(true);
      expect((approved.body as MeBody).matchingEligible).toBe(false);
      const approvedOnline = await request(server)
        .post('/api/v1/driver/availability/go-online')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(approvedOnline.status).toBe(200);
      expect((approvedOnline.body as MeBody).availability?.status).toBe(
        'ONLINE',
      );
      expect((approvedOnline.body as MeBody).matchingEligible).toBe(true);
      expect(await drivers.matchingEligibility(driverId)).toBe(true);
      const onlineDeliveries = await request(server)
        .get('/api/v1/driver/deliveries')
        .set('Authorization', `Bearer ${token}`);
      expect(onlineDeliveries.status).toBe(404);

      const assignments = await prisma
        .getDb()
        .orm.public.DriverAssignment.where({ driverId })
        .all();
      expect(assignments).toHaveLength(0);
      expect(
        await prisma.getDb().orm.public.DriverEarning.where({ driverId }).all(),
      ).toHaveLength(0);
      const live = await prisma
        .getDb()
        .orm.public.DriverProfile.where({ id: driverId })
        .first();
      expect(live?.verificationStatus).toBe('APPROVED');

      const offline = await request(server)
        .post('/api/v1/driver/availability/go-offline')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(offline.status).toBe(200);
      expect((offline.body as MeBody).availability?.status).toBe('OFFLINE');
    } finally {
      await cleanupByPhone(e164[0] ?? '');
      await cleanupByPhone(e164[1] ?? '');
    }
  });

  it('creates only one DriverProfile under concurrent create', async () => {
    const server = app.getHttpServer();
    const phone = `0596${Date.now().toString().slice(-6)}`;
    let e164 = '';
    try {
      const token = await authenticate(phone);
      const me = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      e164 = (me.body as { account: { phone: string } }).account.phone;
      const [first, second] = await Promise.all([
        request(server)
          .post('/api/v1/driver/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ fullName: 'Concurrent Driver' }),
        request(server)
          .post('/api/v1/driver/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ fullName: 'Concurrent Driver' }),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
      const account = await prisma
        .getDb()
        .orm.public.Account.where({ phone: e164 })
        .first();
      const profiles = await prisma
        .getDb()
        .orm.public.DriverProfile.where({ accountId: account!.id })
        .all();
      expect(profiles).toHaveLength(1);
    } finally {
      await cleanupByPhone(e164);
    }
  });

  async function completeOnboarding(
    token: string,
    fullName: string,
    plate: string,
  ): Promise<void> {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/api/v1/driver/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName });
    expect(created.status).toBe(201);
    await request(server)
      .put('/api/v1/driver/documents/IDENTITY')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    await request(server)
      .put('/api/v1/driver/documents/DRIVING_LICENSE')
      .set('Authorization', `Bearer ${token}`)
      .send({ expiryDate: '2099-12-31' });
    const vehicle = await request(server)
      .post('/api/v1/driver/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'MOTORCYCLE',
        plateNumber: plate,
        model: 'NMAX',
      });
    expect(vehicle.status).toBe(201);
  }

  it('conflicts a concurrent verification submit', async () => {
    const server = app.getHttpServer();
    const phone = `0580${Date.now().toString().slice(-6)}`;
    let e164 = '';
    try {
      const token = await authenticate(phone);
      const me = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      e164 = (me.body as { account: { phone: string } }).account.phone;
      await completeOnboarding(token, 'Submit Race', `SR${phone.slice(-4)}`);
      const [first, second] = await Promise.all([
        request(server)
          .post('/api/v1/driver/verification/submit')
          .set('Authorization', `Bearer ${token}`)
          .send({}),
        request(server)
          .post('/api/v1/driver/verification/submit')
          .set('Authorization', `Bearer ${token}`)
          .send({}),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
      const winner = first.status === 200 ? first : second;
      expect((winner.body as MeBody).profile?.verificationStatus).toBe(
        'PENDING_REVIEW',
      );
    } finally {
      await cleanupByPhone(e164);
    }
  });

  it('rejects, allows correction, and resubmits without a rejection reason', async () => {
    const server = app.getHttpServer();
    const phone = `0581${Date.now().toString().slice(-6)}`;
    let e164 = '';
    try {
      const token = await authenticate(phone);
      const me = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      e164 = (me.body as { account: { phone: string } }).account.phone;
      await completeOnboarding(token, 'Reject Driver', `RJ${phone.slice(-4)}`);
      const submitted = await request(server)
        .post('/api/v1/driver/verification/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(submitted.status).toBe(200);
      const driverId = (submitted.body as MeBody).profile!.id;
      await review.reject(driverId);
      const rejected = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${token}`);
      const rejectedBody = rejected.body as MeBody;
      expect(rejectedBody.profile?.verificationStatus).toBe('REJECTED');
      expect(rejectedBody.availability?.status).toBe('OFFLINE');
      expect(JSON.stringify(rejectedBody)).not.toMatch(/rejectionReason/i);
      const corrected = await request(server)
        .patch('/api/v1/driver/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Reject Driver Corrected' });
      expect(corrected.status).toBe(200);
      const resubmitted = await request(server)
        .post('/api/v1/driver/verification/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(resubmitted.status).toBe(200);
      expect((resubmitted.body as MeBody).profile?.verificationStatus).toBe(
        'PENDING_REVIEW',
      );
    } finally {
      await cleanupByPhone(e164);
    }
  });

  it('keeps APPROVED after license expiry and blocks matching', async () => {
    const server = app.getHttpServer();
    const phone = `0582${Date.now().toString().slice(-6)}`;
    let e164 = '';
    try {
      const token = await authenticate(phone);
      const me = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      e164 = (me.body as { account: { phone: string } }).account.phone;
      await completeOnboarding(token, 'Expiry Driver', `EX${phone.slice(-4)}`);
      const submitted = await request(server)
        .post('/api/v1/driver/verification/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      const driverId = (submitted.body as MeBody).profile!.id;
      await review.approve(driverId);
      const ready = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${token}`);
      expect((ready.body as MeBody).operationalReady).toBe(true);
      const online = await request(server)
        .post('/api/v1/driver/availability/go-online')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(online.status).toBe(200);
      const license = await prisma
        .getDb()
        .orm.public.DriverDocument.where({
          driverId,
          type: 'DRIVING_LICENSE',
        })
        .first();
      await prisma
        .getDb()
        .orm.public.DriverDocument.where({ id: license!.id })
        .update({ expiryDate: pgDate('2000-01-01') });
      const expired = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${token}`);
      const expiredBody = expired.body as MeBody;
      expect(expiredBody.profile?.verificationStatus).toBe('APPROVED');
      expect(expiredBody.availability?.status).toBe('ONLINE');
      expect(expiredBody.drivingLicenseComplete).toBe(false);
      expect(expiredBody.operationalReady).toBe(false);
      expect(expiredBody.matchingEligible).toBe(false);
      const offline = await request(server)
        .post('/api/v1/driver/availability/go-offline')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(offline.status).toBe(200);
      const blocked = await request(server)
        .post('/api/v1/driver/availability/go-online')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(blocked.status).toBe(409);
    } finally {
      await cleanupByPhone(e164);
    }
  });

  it('suspends an ONLINE Driver without revoking the Account session', async () => {
    const server = app.getHttpServer();
    const phone = `0583${Date.now().toString().slice(-6)}`;
    let e164 = '';
    try {
      const token = await authenticate(phone);
      const meAuth = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      e164 = (meAuth.body as { account: { phone: string; id: string } }).account
        .phone;
      const accountId = (meAuth.body as { account: { id: string } }).account.id;
      await completeOnboarding(token, 'Suspend Driver', `SU${phone.slice(-4)}`);
      const submitted = await request(server)
        .post('/api/v1/driver/verification/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      const driverId = (submitted.body as MeBody).profile!.id;
      await review.approve(driverId);
      const online = await request(server)
        .post('/api/v1/driver/availability/go-online')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(online.status).toBe(200);
      await review.suspend(driverId);
      const sessions = await prisma
        .getDb()
        .orm.public.Session.where({ accountId })
        .all();
      expect(sessions.length).toBeGreaterThan(0);
      const stillAuth = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(stillAuth.status).toBe(200);
      const suspended = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${token}`);
      expect(suspended.status).toBe(200);
      expect((suspended.body as MeBody).profile?.verificationStatus).toBe(
        'SUSPENDED',
      );
      expect((suspended.body as MeBody).availability?.status).toBe('SUSPENDED');
      expect((suspended.body as MeBody).matchingEligible).toBe(false);
      const blocked = await request(server)
        .post('/api/v1/driver/availability/go-online')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(blocked.status).toBe(409);
    } finally {
      await cleanupByPhone(e164);
    }
  });

  it('keeps at most one ACTIVE vehicle under concurrent create and allows inactive plate reuse', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      first: `0584${suffix}`,
      second: `0585${suffix}`,
    };
    const e164: string[] = [];
    try {
      const tokenA = await authenticate(phones.first);
      const tokenB = await authenticate(phones.second);
      e164.push(
        (
          (
            await request(server)
              .get('/api/v1/auth/me')
              .set('Authorization', `Bearer ${tokenA}`)
          ).body as { account: { phone: string } }
        ).account.phone,
        (
          (
            await request(server)
              .get('/api/v1/auth/me')
              .set('Authorization', `Bearer ${tokenB}`)
          ).body as { account: { phone: string } }
        ).account.phone,
      );
      await request(server)
        .post('/api/v1/driver/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: 'Vehicle A' });
      await request(server)
        .post('/api/v1/driver/profile')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ fullName: 'Vehicle B' });
      const [first, second] = await Promise.all([
        request(server)
          .post('/api/v1/driver/vehicles')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            type: 'MOTORCYCLE',
            plateNumber: `CA${suffix}`,
            model: 'One',
          }),
        request(server)
          .post('/api/v1/driver/vehicles')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            type: 'CAR',
            plateNumber: `CB${suffix}`,
            model: 'Two',
          }),
      ]);
      expect(
        [first.status, second.status].every((status) => status === 201),
      ).toBe(true);
      const meA = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${tokenA}`);
      const active = (meA.body as MeBody).vehicles.filter(
        (vehicle) => vehicle.status === 'ACTIVE',
      );
      expect((meA.body as MeBody).vehicles.length).toBe(2);
      expect(active).toHaveLength(1);
      const historical = (meA.body as MeBody).vehicles.find(
        (vehicle) => vehicle.status === 'INACTIVE',
      );
      expect(historical).toBeTruthy();
      const reuse = await request(server)
        .post('/api/v1/driver/vehicles')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          type: 'SCOOTER',
          plateNumber: historical!.plateNumber,
          model: 'Reuse',
        });
      expect(reuse.status).toBe(201);
    } finally {
      await cleanupByPhone(e164[0] ?? '');
      await cleanupByPhone(e164[1] ?? '');
    }
  });
});
