import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createUuidV7 } from '../src/common/utils/uuid-v7';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { PrismaService } from '../src/infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { RATING_ERROR_CODES } from '../src/modules/ratings/domain/ratings.errors';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';
import { deactivateAllDeliveryZones } from './helpers/sanitize-delivery-zones';

type TokenBody = { accessToken: string };
type AuthMeBody = { account: { id: string; phone: string } };
type ErrorBody = { error: { code: string } };
type RatingBody = {
  id: string;
  orderId: string;
  score: number;
  merchantId?: string;
  driverId?: string;
  comment: string | null;
};
type SummaryBody = {
  count: number;
  average: number | null;
  targetId: string;
};

const COVERING_RING: number[][] = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

describe('Ratings Foundation (e2e)', () => {
  jest.setTimeout(180_000);

  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  const phones: string[] = [];
  const zoneIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OTP_SENDER)
      .useClass(TestOtpSender)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sender = moduleRef.get(OTP_SENDER);
    prisma = moduleRef.get(PrismaService);
    redis = moduleRef.get(RedisService);
  });

  beforeEach(async () => {
    const leftover = await redis.getClient().keys('otp:*');
    if (leftover.length > 0) {
      await redis.getClient().del(...leftover);
    }
  });

  afterAll(async () => {
    for (const phone of phones) {
      await cleanupByPhone(phone);
    }
    for (const zoneId of zoneIds) {
      const db = prisma.getDb().orm.public;
      for (const order of await db.Order.where({
        deliveryZoneId: zoneId,
      }).all()) {
        await deleteRatingsForOrder(order.id);
        const delivery = await db.Delivery.where({ orderId: order.id }).first();
        if (delivery) {
          for (const a of await db.DriverAssignment.where({
            deliveryId: delivery.id,
          }).all()) {
            await db.DriverAssignment.where({ id: a.id }).delete();
          }
          await db.Delivery.where({ id: delivery.id }).delete();
        }
        await db.Order.where({ id: order.id }).delete();
      }
      await db.DeliveryZone.where({ id: zoneId }).delete();
    }
    await app.close();
  });

  async function authenticate(phone: string): Promise<string> {
    phones.push(phone);
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
        deviceName: 'ratings-foundation-e2e',
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

  async function deleteRatingsForOrder(orderId: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    for (const row of await db.DriverRating.where({ orderId }).all()) {
      await db.DriverRating.where({ id: row.id }).delete();
    }
    for (const row of await db.MerchantRating.where({ orderId }).all()) {
      await db.MerchantRating.where({ id: row.id }).delete();
    }
  }

  async function cleanupByPhone(phoneE164: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    const account = await db.Account.where({ phone: phoneE164 }).first();
    if (!account) {
      return;
    }

    const customer = await db.CustomerProfile.where({
      accountId: account.id,
    }).first();
    if (customer) {
      for (const order of await db.Order.where({
        customerId: customer.id,
      }).all()) {
        await deleteRatingsForOrder(order.id);
        const delivery = await db.Delivery.where({ orderId: order.id }).first();
        if (delivery) {
          for (const a of await db.DriverAssignment.where({
            deliveryId: delivery.id,
          }).all()) {
            await db.DriverAssignment.where({ id: a.id }).delete();
          }
          await db.Delivery.where({ id: delivery.id }).delete();
        }
        await db.Order.where({ id: order.id }).delete();
      }
      await db.CustomerProfile.where({ id: customer.id }).delete();
    }

    const driver = await db.DriverProfile.where({
      accountId: account.id,
    }).first();
    if (driver) {
      for (const row of await db.DriverRating.where({
        driverId: driver.id,
      }).all()) {
        await db.DriverRating.where({ id: row.id }).delete();
      }
      await db.DriverProfile.where({ id: driver.id }).delete();
    }

    for (const membership of await db.MerchantMember.where({
      accountId: account.id,
    }).all()) {
      const merchantId = membership.merchantId;
      await db.MerchantMember.where({ id: membership.id }).delete();
      for (const row of await db.MerchantRating.where({ merchantId }).all()) {
        await db.MerchantRating.where({ id: row.id }).delete();
      }
      for (const branch of await db.MerchantBranch.where({
        merchantId,
      }).all()) {
        for (const order of await db.Order.where({
          merchantBranchId: branch.id,
        }).all()) {
          await deleteRatingsForOrder(order.id);
          const delivery = await db.Delivery.where({
            orderId: order.id,
          }).first();
          if (delivery) {
            for (const a of await db.DriverAssignment.where({
              deliveryId: delivery.id,
            }).all()) {
              await db.DriverAssignment.where({ id: a.id }).delete();
            }
            await db.Delivery.where({ id: delivery.id }).delete();
          }
          await db.Order.where({ id: order.id }).delete();
        }
        await db.MerchantBranch.where({ id: branch.id }).delete();
      }
      await db.Merchant.where({ id: merchantId }).delete();
    }

    for (const session of await db.Session.where({
      accountId: account.id,
    }).all()) {
      await db.Session.where({ id: session.id }).delete();
    }
    for (const device of await db.Device.where({
      accountId: account.id,
    }).all()) {
      await db.Device.where({ id: device.id }).delete();
    }
    await deleteAccountNotificationArtifacts(prisma, account.id);
    await db.Account.where({ id: account.id }).delete();
  }

  it('covers eligibility, ownership, uniqueness, aggregates, and isolation', async () => {
    const suffix = `${Date.now().toString().slice(-6)}`;
    const server = app.getHttpServer();
    await deactivateAllDeliveryZones(prisma);

    const customerToken = await authenticate(`0591${suffix}`);
    const foreignToken = await authenticate(`0592${suffix}`);
    const ownerToken = await authenticate(`0593${suffix}`);
    const driverToken = await authenticate(`0594${suffix}`);

    const rejectedToken = await authenticate(`0595${suffix}`);
    const rejectedAcct = await authMe(rejectedToken);

    const customer = await authMe(customerToken);
    const foreign = await authMe(foreignToken);
    const owner = await authMe(ownerToken);
    const driverAcct = await authMe(driverToken);

    await request(server)
      .post('/api/v1/customer/profile')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'Ratings Customer' });
    await request(server)
      .post('/api/v1/customer/profile')
      .set('Authorization', `Bearer ${foreignToken}`)
      .send({ fullName: 'Foreign Ratings Customer' });

    const customerProfile = await prisma
      .getDb()
      .orm.public.CustomerProfile.where({ accountId: customer.id })
      .first();
    const foreignProfile = await prisma
      .getDb()
      .orm.public.CustomerProfile.where({ accountId: foreign.id })
      .first();
    expect(customerProfile).toBeTruthy();
    expect(foreignProfile).toBeTruthy();

    const merchantRes = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Ratings Shop ${suffix}` });
    expect(merchantRes.status).toBe(201);
    const merchantId = (merchantRes.body as { merchantId: string }).merchantId;

    const branchRes = await request(server)
      .post(`/api/v1/merchant/${merchantId}/branches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Main',
        phone: `0551${suffix}`,
        addressText: 'Pickup',
        latitude: 36.75,
        longitude: 3.05,
      });
    expect(branchRes.status).toBe(201);
    const branchId = (branchRes.body as { id: string }).id;

    const now = pgNow();
    const zoneId = createUuidV7();
    await prisma.getDb().orm.public.DeliveryZone.create({
      id: zoneId,
      name: pgVarchar<255>(`Ratings zone ${suffix}`),
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[COVERING_RING]],
        srid: 4326,
      },
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    zoneIds.push(zoneId);

    const driverId = createUuidV7();
    await prisma.getDb().orm.public.DriverProfile.create({
      id: driverId,
      accountId: driverAcct.id,
      fullName: pgVarchar<255>('Ratings Driver'),
      verificationStatus: pgVarchar<64>('APPROVED'),
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    async function seedCompletedOrder(opts: {
      customerId: string;
      orderStatus?: string;
      deliveryStatus?: string | null;
      withAssignment?: boolean;
      rejectedDriverId?: string;
    }): Promise<string> {
      const orderId = createUuidV7();
      await prisma.getDb().orm.public.Order.create({
        id: orderId,
        publicReference: pgVarchar<64>(
          `sgo_rt_${orderId.replace(/-/g, '').slice(0, 20)}`,
        ),
        customerId: opts.customerId,
        merchantBranchId: branchId,
        deliveryZoneId: zoneId,
        status: (opts.orderStatus ?? 'COMPLETED') as never,
        fulfillmentStatus: 'READY',
        createdAt: now,
        confirmedAt: now,
        completedAt: opts.orderStatus === 'ACTIVE' ? null : now,
        updatedAt: now,
      });
      if (opts.deliveryStatus !== null) {
        const deliveryId = createUuidV7();
        await prisma.getDb().orm.public.Delivery.create({
          id: deliveryId,
          orderId,
          status: (opts.deliveryStatus ?? 'DELIVERED') as never,
          driverSearchStartedAt: now,
          deliveredAt:
            (opts.deliveryStatus ?? 'DELIVERED') === 'DELIVERED' ? now : null,
          createdAt: now,
          updatedAt: now,
        });
        if (opts.withAssignment === true) {
          for (const prior of await prisma
            .getDb()
            .orm.public.DriverAssignment.where({ driverId })
            .all()) {
            if (prior.releasedAt === null) {
              await prisma
                .getDb()
                .orm.public.DriverAssignment.where({ id: prior.id })
                .update({ releasedAt: now });
            }
          }
          // Simulate Driver Delivery Workflow completion: ACCEPTED → RELEASED.
          await prisma.getDb().orm.public.DriverAssignment.create({
            id: createUuidV7(),
            deliveryId,
            driverId,
            status: pgVarchar<64>('RELEASED'),
            assignedAt: now,
            acceptedAt: now,
            releasedAt: now,
          });
        }
        if (opts.rejectedDriverId) {
          await prisma.getDb().orm.public.DriverAssignment.create({
            id: createUuidV7(),
            deliveryId,
            driverId: opts.rejectedDriverId,
            status: pgVarchar<64>('REJECTED'),
            assignedAt: now,
            acceptedAt: null,
            releasedAt: now,
          });
        }
      }
      return orderId;
    }

    const rejectedDriverId = createUuidV7();
    await prisma.getDb().orm.public.DriverProfile.create({
      id: rejectedDriverId,
      accountId: rejectedAcct.id,
      fullName: pgVarchar<255>('Rejected Offer Driver'),
      verificationStatus: pgVarchar<64>('APPROVED'),
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const orderId = await seedCompletedOrder({
      customerId: customerProfile!.id,
      withAssignment: true,
      rejectedDriverId,
    });
    const prematureOrderId = await seedCompletedOrder({
      customerId: customerProfile!.id,
      orderStatus: 'ACTIVE',
      deliveryStatus: 'IN_TRANSIT',
      withAssignment: false,
    });
    const foreignOrderId = await seedCompletedOrder({
      customerId: foreignProfile!.id,
      withAssignment: false,
    });
    const secondOrderId = await seedCompletedOrder({
      customerId: customerProfile!.id,
      withAssignment: false,
    });

    // Premature rating blocked
    const premature = await request(server)
      .post(`/api/v1/customer/orders/${prematureOrderId}/ratings/merchant`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ score: 5 });
    expect(premature.status).toBe(409);
    expect((premature.body as ErrorBody).error.code).toBe(
      RATING_ERROR_CODES.RATING_INVALID_STATE,
    );

    // Foreign Order blocked
    const foreignRate = await request(server)
      .post(`/api/v1/customer/orders/${foreignOrderId}/ratings/merchant`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ score: 5 });
    expect(foreignRate.status).toBe(404);

    // Spoof fields rejected
    const spoof = await request(server)
      .post(`/api/v1/customer/orders/${orderId}/ratings/merchant`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        score: 5,
        merchantId: createUuidV7(),
        authorId: foreign.id,
        customerId: foreignProfile!.id,
        driverId,
      });
    expect(spoof.status).toBe(400);

    // Valid merchant rating
    const merchantRated = await request(server)
      .post(`/api/v1/customer/orders/${orderId}/ratings/merchant`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ score: 5, comment: '  Great food  ' });
    expect(merchantRated.status).toBe(201);
    const merchantBody = merchantRated.body as RatingBody;
    expect(merchantBody.merchantId).toBe(merchantId);
    expect(merchantBody.score).toBe(5);
    expect(merchantBody.comment).toBe('Great food');

    // Own read
    const ownMerchant = await request(server)
      .get(`/api/v1/customer/orders/${orderId}/ratings/merchant`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(ownMerchant.status).toBe(200);
    expect((ownMerchant.body as RatingBody).id).toBe(merchantBody.id);

    // Foreign cannot read
    const foreignOwn = await request(server)
      .get(`/api/v1/customer/orders/${orderId}/ratings/merchant`)
      .set('Authorization', `Bearer ${foreignToken}`);
    expect(foreignOwn.status).toBe(404);

    // Duplicate conflict
    const dup = await request(server)
      .post(`/api/v1/customer/orders/${orderId}/ratings/merchant`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ score: 1 });
    expect(dup.status).toBe(409);
    expect((dup.body as ErrorBody).error.code).toBe(
      RATING_ERROR_CODES.RATING_ALREADY_EXISTS,
    );

    // Concurrent duplicate → exactly one row
    await Promise.all([
      request(server)
        .post(`/api/v1/customer/orders/${secondOrderId}/ratings/merchant`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ score: 4 }),
      request(server)
        .post(`/api/v1/customer/orders/${secondOrderId}/ratings/merchant`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ score: 4 }),
    ]);
    const merchantRows = await prisma
      .getDb()
      .orm.public.MerchantRating.where({
        orderId: secondOrderId,
        customerId: customerProfile!.id,
      })
      .all();
    expect(merchantRows).toHaveLength(1);
    expect(merchantRows[0]!.score).toBe(4);

    // Driver rating derived from RELEASED historical serving assignment
    // (not open ACCEPTED; not prior REJECTED offer)
    const driverRated = await request(server)
      .post(`/api/v1/customer/orders/${orderId}/ratings/driver`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ score: 4 });
    expect(driverRated.status).toBe(201);
    expect((driverRated.body as RatingBody).driverId).toBe(driverId);
    expect((driverRated.body as RatingBody).driverId).not.toBe(
      rejectedDriverId,
    );

    // Target later SUSPENDED does not invalidate historical rating eligibility
    // (second order with RELEASED serving assignment after suspension)
    await prisma
      .getDb()
      .orm.public.DriverProfile.where({ id: driverId })
      .update({
        verificationStatus: pgVarchar<64>('SUSPENDED'),
        updatedAt: pgNow(),
      });
    const suspendedOrderId = await seedCompletedOrder({
      customerId: customerProfile!.id,
      withAssignment: true,
    });
    const afterSuspend = await request(server)
      .post(`/api/v1/customer/orders/${suspendedOrderId}/ratings/driver`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ score: 3 });
    expect(afterSuspend.status).toBe(201);
    expect((afterSuspend.body as RatingBody).driverId).toBe(driverId);

    // Cancelled / Failed not rateable
    const cancelledId = await seedCompletedOrder({
      customerId: customerProfile!.id,
      orderStatus: 'CANCELLED',
      deliveryStatus: null,
      withAssignment: false,
    });
    const cancelledRate = await request(server)
      .post(`/api/v1/customer/orders/${cancelledId}/ratings/merchant`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ score: 1 });
    expect(cancelledRate.status).toBe(409);

    const failedId = await seedCompletedOrder({
      customerId: customerProfile!.id,
      orderStatus: 'FAILED',
      deliveryStatus: null,
      withAssignment: false,
    });
    const failedRate = await request(server)
      .post(`/api/v1/customer/orders/${failedId}/ratings/merchant`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ score: 1 });
    expect(failedRate.status).toBe(409);

    // Invalid score
    const badScore = await request(server)
      .post(`/api/v1/customer/orders/${secondOrderId}/ratings/driver`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ score: 9 });
    expect(badScore.status).toBe(400);

    // Summaries
    const merchantSummary = await request(server)
      .get(`/api/v1/customer/merchants/${merchantId}/ratings/summary`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(merchantSummary.status).toBe(200);
    const mSum = merchantSummary.body as SummaryBody;
    expect(mSum.count).toBe(2);
    expect(mSum.average).toBe(4.5);

    const emptySummary = await request(server)
      .get(`/api/v1/customer/drivers/${rejectedDriverId}/ratings/summary`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(emptySummary.status).toBe(200);
    expect((emptySummary.body as SummaryBody).count).toBe(0);
    expect((emptySummary.body as SummaryBody).average).toBeNull();

    const driverSummary = await request(server)
      .get('/api/v1/driver/ratings/summary')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(driverSummary.status).toBe(200);
    expect((driverSummary.body as SummaryBody).count).toBe(2);
    expect((driverSummary.body as SummaryBody).average).toBe(3.5);

    const merchantMemberSummary = await request(server)
      .get(`/api/v1/merchant/${merchantId}/ratings/summary`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(merchantMemberSummary.status).toBe(200);

    // No business side effects / no Support ticket / no RATING notifications
    const orderAfter = await prisma
      .getDb()
      .orm.public.Order.where({ id: orderId })
      .first();
    expect(orderAfter?.status).toBe('COMPLETED');
    const notifications = await prisma
      .getDb()
      .orm.public.Notification.where({ accountId: customer.id })
      .all();
    expect(
      notifications.filter((n) => String(n.category).startsWith('RATING_')),
    ).toHaveLength(0);

    void owner;
  });
});
