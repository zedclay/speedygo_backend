import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { deactivateAllDeliveryZones } from './helpers/sanitize-delivery-zones';
import { createUuidV7 } from '../src/common/utils/uuid-v7';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { PrismaService } from '../src/infrastructure/database/database.module';
import {
  pgBigInt,
  pgNow,
  pgTimestamptz,
  pgVarchar,
} from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { DriverReviewService } from '../src/modules/drivers/application/driver-review.service';
import { MatchingService } from '../src/modules/matching/application/matching.service';
import {
  MATCHING_JOB_TIMEOUT,
  MATCHING_QUEUE_NAME,
} from '../src/modules/matching/domain/matching.jobs';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '../src/modules/matching/domain/matching.types';
import { MatchingRecoveryService } from '../src/modules/matching/infrastructure/matching-recovery.service';
import { MatchingProcessor } from '../src/modules/matching/infrastructure/matching.processor';

type TokenBody = { accessToken: string };
type AuthMeBody = { account: { id: string; phone: string } };
type MembershipBody = { merchantId: string };
type BranchBody = { id: string };
type CategoryBody = { id: string };
type ProductBody = { id: string };
type OptionGroupBody = { id: string };
type OptionBody = { id: string };
type AddressBody = { id: string };
type PreviewBody = {
  merchandiseSubtotalMinor: number;
  deliveryFeeMinor: number;
  customerTotalMinor: number;
};
type OfferBody = {
  offer: {
    assignmentId: string;
    status: string;
    driverRemunerationMinor: number;
    pickup: { name: string };
  } | null;
};

const INSIDE: [number, number] = [36.75, 3.05];
const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

describe('Driver matching (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let matching: MatchingService;
  let review: DriverReviewService;
  let locations: DriverLocationStore;
  let processor: MatchingProcessor;
  let recovery: MatchingRecoveryService;
  let queue: Queue;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sender = app.get(OTP_SENDER);
    prisma = app.get(PrismaService);
    await deactivateAllDeliveryZones(prisma);
    redis = app.get(RedisService);
    matching = app.get(MatchingService);
    review = app.get(DriverReviewService);
    locations = app.get(DRIVER_LOCATION_STORE);
    processor = app.get(MatchingProcessor);
    recovery = app.get(MatchingRecoveryService);
    queue = app.get<Queue>(getQueueToken(MATCHING_QUEUE_NAME));
    await queue.obliterate({ force: true });
    for (const pattern of [
      'auth:test:*',
      'matching:test:*',
      'bull:matching:test*',
    ]) {
      const leftover = await redis.getClient().keys(pattern);
      if (leftover.length > 0) {
        await redis.getClient().del(...leftover);
      }
    }
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
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
        deviceName: 'matching-e2e',
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

  async function onboardApprovedDriver(
    token: string,
    name: string,
    plate: string,
  ): Promise<string> {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/v1/driver/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: name });
    await request(server)
      .put('/api/v1/driver/documents/IDENTITY')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    await request(server)
      .put('/api/v1/driver/documents/DRIVING_LICENSE')
      .set('Authorization', `Bearer ${token}`)
      .send({ expiryDate: '2099-12-31' });
    await request(server)
      .post('/api/v1/driver/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'MOTORCYCLE', plateNumber: plate, model: 'NMAX' });
    const submitted = await request(server)
      .post('/api/v1/driver/verification/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const driverId = (submitted.body as { profile: { id: string } }).profile.id;
    await review.approve(driverId);
    await request(server)
      .post('/api/v1/driver/availability/go-online')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    return driverId;
  }

  async function waitForOffer(
    token: string,
    timeoutMs = 8000,
  ): Promise<NonNullable<OfferBody['offer']>> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/driver/assignments/current-offer')
        .set('Authorization', `Bearer ${token}`);
      const offer = (response.body as OfferBody).offer;
      if (offer) {
        return offer;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('timed out waiting for Driver offer');
  }

  async function cleanupByPhone(phoneE164: string): Promise<void> {
    const account = await prisma
      .getDb()
      .orm.public.Account.where({ phone: phoneE164 })
      .first();
    if (!account) {
      return;
    }
    const driver = await prisma
      .getDb()
      .orm.public.DriverProfile.where({ accountId: account.id })
      .first();
    if (driver) {
      const assignments = await prisma
        .getDb()
        .orm.public.DriverAssignment.where({ driverId: driver.id })
        .all();
      for (const assignment of assignments) {
        await prisma
          .getDb()
          .orm.public.DriverAssignment.where({ id: assignment.id })
          .delete();
      }
      const docs = await prisma
        .getDb()
        .orm.public.DriverDocument.where({ driverId: driver.id })
        .all();
      for (const doc of docs) {
        await prisma
          .getDb()
          .orm.public.DriverDocument.where({ id: doc.id })
          .delete();
      }
      const vehicles = await prisma
        .getDb()
        .orm.public.Vehicle.where({ driverId: driver.id })
        .all();
      for (const vehicle of vehicles) {
        await prisma
          .getDb()
          .orm.public.Vehicle.where({ id: vehicle.id })
          .delete();
      }
      for (const entry of await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({ driverId: driver.id })
        .all()) {
        await prisma
          .getDb()
          .orm.public.FinancialLedgerEntry.where({ id: entry.id })
          .delete();
      }
      await prisma
        .getDb()
        .orm.public.DriverProfile.where({ id: driver.id })
        .delete();
    }
    const profile = await prisma
      .getDb()
      .orm.public.CustomerProfile.where({ accountId: account.id })
      .first();
    if (profile) {
      const orders = await prisma
        .getDb()
        .orm.public.Order.where({ customerId: profile.id })
        .all();
      for (const order of orders) {
        const delivery = await prisma
          .getDb()
          .orm.public.Delivery.where({ orderId: order.id })
          .first();
        if (delivery) {
          const events = await prisma
            .getDb()
            .orm.public.DeliveryEvent.where({ deliveryId: delivery.id })
            .all();
          for (const event of events) {
            await prisma
              .getDb()
              .orm.public.DeliveryEvent.where({ id: event.id })
              .delete();
          }
          const leftover = await prisma
            .getDb()
            .orm.public.DriverAssignment.where({ deliveryId: delivery.id })
            .all();
          for (const assignment of leftover) {
            await prisma
              .getDb()
              .orm.public.DriverAssignment.where({ id: assignment.id })
              .delete();
          }
          await prisma
            .getDb()
            .orm.public.Delivery.where({ id: delivery.id })
            .delete();
        }
        const payments = await prisma
          .getDb()
          .orm.public.Payment.where({ orderId: order.id })
          .all();
        for (const payment of payments) {
          await prisma
            .getDb()
            .orm.public.Payment.where({ id: payment.id })
            .delete();
        }
        const statusEvents = await prisma
          .getDb()
          .orm.public.OrderStatusEvent.where({ orderId: order.id })
          .all();
        for (const event of statusEvents) {
          await prisma
            .getDb()
            .orm.public.OrderStatusEvent.where({ id: event.id })
            .delete();
        }
        const cancellation = await prisma
          .getDb()
          .orm.public.OrderCancellation.where({ orderId: order.id })
          .first();
        if (cancellation) {
          await prisma
            .getDb()
            .orm.public.OrderCancellation.where({ id: cancellation.id })
            .delete();
        }
        const items = await prisma
          .getDb()
          .orm.public.OrderItem.where({ orderId: order.id })
          .all();
        for (const item of items) {
          const options = await prisma
            .getDb()
            .orm.public.OrderItemOption.where({ orderItemId: item.id })
            .all();
          for (const option of options) {
            await prisma
              .getDb()
              .orm.public.OrderItemOption.where({ id: option.id })
              .delete();
          }
          await prisma
            .getDb()
            .orm.public.OrderItem.where({ id: item.id })
            .delete();
        }
        await prisma
          .getDb()
          .orm.public.OrderFinancialSnapshot.where({ orderId: order.id })
          .delete();
        await prisma
          .getDb()
          .orm.public.OrderDeliveryAddressSnapshot.where({ orderId: order.id })
          .delete();
        for (const entry of await prisma
          .getDb()
          .orm.public.FinancialLedgerEntry.where({ orderId: order.id })
          .all()) {
          await prisma
            .getDb()
            .orm.public.FinancialLedgerEntry.where({ id: entry.id })
            .delete();
        }
        await prisma.getDb().orm.public.Order.where({ id: order.id }).delete();
      }
      const carts = await prisma
        .getDb()
        .orm.public.Cart.where({ customerId: profile.id })
        .all();
      for (const cart of carts) {
        await prisma.getDb().orm.public.Cart.where({ id: cart.id }).delete();
      }
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
    const members = await prisma
      .getDb()
      .orm.public.MerchantMember.where({ accountId: account.id })
      .all();
    const merchantIds = [...new Set(members.map((row) => row.merchantId))];
    for (const merchantId of merchantIds) {
      const branches = await prisma
        .getDb()
        .orm.public.MerchantBranch.where({ merchantId })
        .all();
      for (const branch of branches) {
        const cartsOnBranch = await prisma
          .getDb()
          .orm.public.Cart.where({ merchantBranchId: branch.id })
          .all();
        for (const cart of cartsOnBranch) {
          await prisma.getDb().orm.public.Cart.where({ id: cart.id }).delete();
        }
        const products = await prisma
          .getDb()
          .orm.public.Product.where({ merchantBranchId: branch.id })
          .all();
        for (const product of products) {
          await prisma
            .getDb()
            .orm.public.Product.where({ id: product.id })
            .delete();
        }
        const categories = await prisma
          .getDb()
          .orm.public.Category.where({ merchantBranchId: branch.id })
          .all();
        for (const category of categories) {
          await prisma
            .getDb()
            .orm.public.Category.where({ id: category.id })
            .delete();
        }
        await prisma
          .getDb()
          .orm.public.MerchantBranch.where({ id: branch.id })
          .delete();
      }
      const remaining = await prisma
        .getDb()
        .orm.public.MerchantMember.where({ merchantId })
        .all();
      for (const member of remaining) {
        await prisma
          .getDb()
          .orm.public.MerchantMember.where({ id: member.id })
          .delete();
      }
      await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantId })
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

  it('matches, accepts, rejects-to-next, times out, and respects privacy', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0571${suffix}`,
      owner: `0572${suffix}`,
      driverA: `0573${suffix}`,
      driverB: `0574${suffix}`,
    };
    const e164: string[] = [];
    const zoneIds: string[] = [];
    const adminIds: string[] = [];
    const roleIds: string[] = [];
    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenOwner = await authenticate(phones.owner);
      const tokenA = await authenticate(phones.driverA);
      const tokenB = await authenticate(phones.driverB);
      const accountCustomer = await authMe(tokenCustomer);
      const accountOwner = await authMe(tokenOwner);
      e164.push(
        accountCustomer.phone,
        accountOwner.phone,
        (await authMe(tokenA)).phone,
        (await authMe(tokenB)).phone,
      );

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'Match Customer' });
      const home = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          label: 'Home',
          addressText: 'Secret dropoff 12',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const homeId = (home.body as AddressBody).id;
      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Match Cafe' });
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'Main',
          phone: '0550123499',
          addressText: 'Street A',
          latitude: 36.75,
          longitude: 3.05,
        });
      const branchId = (branch.body as BranchBody).id;
      await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantId })
        .update({
          status: pgVarchar<64>('ACTIVE'),
          verifiedAt: pgNow(),
          updatedAt: pgNow(),
        });
      const now = pgNow();
      const category = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ branchId, name: 'Drinks' });
      const product = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          branchId,
          categoryId: (category.body as CategoryBody).id,
          name: 'Tea',
          priceMinor: 1000,
        });
      const productId = (product.body as ProductBody).id;
      const group = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'Size',
          required: true,
          minSelections: 1,
          maxSelections: 1,
        });
      const large = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups/${(group.body as OptionGroupBody).id}/options`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Large', additionalPriceMinor: 200 });
      const largeId = (large.body as OptionBody).id;
      const zoneId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Match zone ${suffix}`),
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
      await prisma.getDb().orm.public.DeliveryPricingRule.create({
        id: createUuidV7(),
        zoneId,
        name: pgVarchar<255>('All day'),
        timeBand: 'DAY',
        startLocalTime: null,
        endLocalTime: null,
        customerDeliveryFeeMinor: pgBigInt(500),
        driverRemunerationMinor: pgBigInt(300),
        effectiveFrom: pgTimestamptz('2020-01-01T00:00:00.000Z'),
        effectiveTo: null,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      const roleId = createUuidV7();
      await prisma.getDb().orm.public.Role.create({
        id: roleId,
        name: pgVarchar<128>(`match-e2e-${suffix}`),
        description: null,
        active: true,
      });
      roleIds.push(roleId);
      const adminId = createUuidV7();
      await prisma.getDb().orm.public.AdminProfile.create({
        id: adminId,
        accountId: accountOwner.id,
        roleId,
        displayName: pgVarchar<255>('Match Admin'),
        twoFactorEnabled: false,
        createdAt: now,
        updatedAt: now,
      });
      adminIds.push(adminId);
      await prisma.getDb().orm.public.MerchantCommissionRule.create({
        id: createUuidV7(),
        scope: 'GLOBAL_DEFAULT',
        merchantId: null,
        rateBps: 700,
        effectiveFrom: pgTimestamptz('2020-01-01T00:00:00.000Z'),
        effectiveTo: null,
        changeReason: null,
        changedByAdminId: adminId,
        active: true,
        createdAt: now,
      });

      async function addReadyOrder(): Promise<string> {
        await request(server)
          .post('/api/v1/customer/cart/items')
          .set('Authorization', `Bearer ${tokenCustomer}`)
          .send({ productId, quantity: 1, optionIds: [largeId] });
        const preview = await request(server)
          .post('/api/v1/customer/checkout/preview')
          .set('Authorization', `Bearer ${tokenCustomer}`)
          .send({ addressId: homeId });
        const created = await request(server)
          .post('/api/v1/customer/orders')
          .set('Authorization', `Bearer ${tokenCustomer}`)
          .send({
            addressId: homeId,
            paymentMethod: 'COD',
            expectedMerchandiseSubtotalMinor: (preview.body as PreviewBody)
              .merchandiseSubtotalMinor,
            expectedDeliveryFeeMinor: (preview.body as PreviewBody)
              .deliveryFeeMinor,
            expectedCustomerTotalMinor: (preview.body as PreviewBody)
              .customerTotalMinor,
          });
        expect(created.status).toBe(201);
        const orderId = (created.body as { id: string }).id;
        await request(server)
          .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/accept`)
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({});
        await request(server)
          .post(
            `/api/v1/merchant/${merchantId}/orders/${orderId}/start-preparation`,
          )
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({});
        await request(server)
          .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/mark-ready`)
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({});
        return orderId;
      }

      const driverA = await onboardApprovedDriver(
        tokenA,
        'Near Driver',
        `MA${suffix}`,
      );
      const driverB = await onboardApprovedDriver(
        tokenB,
        'Far Driver',
        `MB${suffix}`,
      );
      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      await locations.upsert(driverB, 36.753, 3.053, new Date().toISOString());

      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        '2020-01-01T00:00:00.000Z',
      );
      const staleOrder = await addReadyOrder();
      await recovery.recover();
      try {
        await waitForOffer(tokenB);
      } catch {
        // BullMQ worker may still be catching up. startForReadyOrder is idempotent.
      }
      const staleMatch = await matching.startForReadyOrder(staleOrder);
      expect(staleMatch.offered).toBe(true);
      expect(staleMatch.assignment?.driverId).toBe(driverB);
      const accountB = await authMe(tokenB);
      await matching.reject(accountB.id, staleMatch.assignment!.id);
      const idleStale = await matching.startForReadyOrder(staleOrder);
      expect(idleStale.offered).toBe(false);
      expect(idleStale.deliveryStatus).toBe('SEARCHING_DRIVER');
      const idleOrder = await prisma
        .getDb()
        .orm.public.Order.where({ id: staleOrder })
        .first();
      expect(idleOrder?.status).toBe('ACTIVE');
      expect(idleOrder?.fulfillmentStatus).toBe('READY');
      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      const laterStale = await matching.matchDelivery(staleMatch.deliveryId);
      expect(laterStale.assignment?.driverId).toBe(driverA);
      await matching.reject(
        (await authMe(tokenA)).id,
        laterStale.assignment!.id,
      );
      const noReoffer = await matching.matchDelivery(staleMatch.deliveryId);
      expect(noReoffer.assignment?.driverId).not.toBe(driverA);

      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      await locations.upsert(driverB, 36.753, 3.053, new Date().toISOString());

      const orderId = await addReadyOrder();
      const first = await matching.startForReadyOrder(orderId);
      expect(first.offered).toBe(true);
      expect(first.assignment?.driverId).toBe(driverA);
      const queuedA = await waitForOffer(tokenA);
      expect(queuedA.assignmentId).toBe(first.assignment?.id);
      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        '2020-01-01T00:00:00.000Z',
      );
      const staleAccept = await request(server)
        .post(`/api/v1/driver/assignments/${first.assignment!.id}/accept`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(staleAccept.status).toBe(409);
      expect((staleAccept.body as { error: { code: string } }).error.code).toBe(
        'DRIVER_LOCATION_STALE',
      );
      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      const offerA = await request(server)
        .get('/api/v1/driver/assignments/current-offer')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(offerA.status).toBe(200);
      const offerBody = offerA.body as OfferBody;
      expect(offerBody.offer?.assignmentId).toBe(first.assignment?.id);
      expect(offerBody.offer?.driverRemunerationMinor).toBe(300);
      expect(JSON.stringify(offerBody)).not.toContain('0550123499');
      expect(JSON.stringify(offerBody)).not.toContain('Secret dropoff 12');
      const foreignOffer = await request(server)
        .get('/api/v1/driver/assignments/current-offer')
        .set('Authorization', `Bearer ${tokenB}`);
      expect((foreignOffer.body as OfferBody).offer).toBeNull();
      const browse = await request(server)
        .get('/api/v1/driver/deliveries')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(browse.status).toBe(404);

      await matching.reject((await authMe(tokenA)).id, first.assignment!.id);
      const afterReject = await prisma
        .getDb()
        .orm.public.Delivery.where({ orderId })
        .first();
      expect(afterReject?.status).toBe('SEARCHING_DRIVER');
      const nextOffer = await request(server)
        .get('/api/v1/driver/assignments/current-offer')
        .set('Authorization', `Bearer ${tokenB}`);
      expect((nextOffer.body as OfferBody).offer?.assignmentId).toBeTruthy();

      const accepted = await request(server)
        .post(
          `/api/v1/driver/assignments/${(nextOffer.body as OfferBody).offer!.assignmentId}/accept`,
        )
        .set('Authorization', `Bearer ${tokenB}`)
        .send({});
      expect(accepted.status).toBe(200);
      expect((accepted.body as { status: string }).status).toBe('ACCEPTED');
      const assignedEvents = await prisma
        .getDb()
        .orm.public.DeliveryEvent.where({
          deliveryId: (await prisma
            .getDb()
            .orm.public.Delivery.where({ orderId })
            .first())!.id,
        })
        .all();
      expect(
        assignedEvents.filter((event) => event.type === 'DRIVER_ASSIGNED'),
      ).toHaveLength(1);
      const currentB = await request(server)
        .get('/api/v1/driver/assignments/current')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(currentB.status).toBe(200);
      expect(JSON.stringify(currentB.body)).toContain('Secret dropoff 12');
      expect(JSON.stringify(currentB.body)).not.toContain(
        accountCustomer.phone,
      );
      const foreignCurrent = await request(server)
        .get('/api/v1/driver/assignments/current')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(
        (foreignCurrent.body as { assignment: unknown }).assignment,
      ).toBeNull();
      const delivery = await prisma
        .getDb()
        .orm.public.Delivery.where({ orderId })
        .first();
      expect(delivery?.status).toBe('DRIVER_ASSIGNED');
      const order = await prisma
        .getDb()
        .orm.public.Order.where({ id: orderId })
        .first();
      expect(order?.status).toBe('ACTIVE');
      expect(order?.fulfillmentStatus).toBe('READY');
      expect(
        await prisma
          .getDb()
          .orm.public.DriverEarning.where({ driverId: driverB })
          .all(),
      ).toHaveLength(0);
      expect(
        await prisma.getDb().orm.public.CodCollection.where({ orderId }).all(),
      ).toHaveLength(0);
      const orderPayments = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId })
        .all();
      for (const payment of orderPayments) {
        expect(
          await prisma
            .getDb()
            .orm.public.PaymentTransaction.where({ paymentId: payment.id })
            .all(),
        ).toHaveLength(0);
      }

      const aHistory = await prisma
        .getDb()
        .orm.public.DriverAssignment.where({
          deliveryId: delivery!.id,
          driverId: driverA,
        })
        .all();
      expect(aHistory).toHaveLength(1);
      expect(aHistory[0].status).toBe('REJECTED');

      const offline = await request(server)
        .post('/api/v1/driver/availability/go-offline')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({});
      expect(offline.status).toBe(200);
      expect(
        (offline.body as { availability: { status: string } }).availability
          .status,
      ).toBe('OFFLINE_AFTER_CURRENT_DELIVERY');

      const secondOrder = await addReadyOrder();
      const secondMatch = await matching.startForReadyOrder(secondOrder);
      expect(secondMatch.assignment?.driverId).not.toBe(driverB);
      if (secondMatch.assignment) {
        await matching.reject(
          (await authMe(tokenA)).id,
          secondMatch.assignment.id,
        );
      }

      const timeoutOrder = await addReadyOrder();
      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      const timed = await matching.startForReadyOrder(timeoutOrder);
      expect(timed.assignment?.driverId).toBe(driverA);
      await prisma
        .getDb()
        .orm.public.DriverAssignment.where({ id: timed.assignment!.id })
        .update({ assignedAt: pgTimestamptz('2020-01-01T00:00:00.000Z') });
      await processor.process({
        name: MATCHING_JOB_TIMEOUT,
        data: { assignmentId: timed.assignment!.id },
      } as never);
      const expired = await prisma
        .getDb()
        .orm.public.DriverAssignment.where({ id: timed.assignment!.id })
        .first();
      expect(expired?.status).toBe('EXPIRED');
      expect(expired?.releasedAt).toBeTruthy();
      await processor.process({
        name: MATCHING_JOB_TIMEOUT,
        data: { assignmentId: timed.assignment!.id },
      } as never);
      const expiredAgain = await prisma
        .getDb()
        .orm.public.DriverAssignment.where({ id: timed.assignment!.id })
        .first();
      expect(expiredAgain?.status).toBe('EXPIRED');
      const [acceptRace, expireRace] = await Promise.all([
        request(server)
          .post(`/api/v1/driver/assignments/${timed.assignment!.id}/accept`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({}),
        matching.expireOffer(timed.assignment!.id),
      ]);
      expect(acceptRace.status).toBe(409);
      expect(expireRace?.status).toBe('EXPIRED');
      const timedDelivery = await prisma
        .getDb()
        .orm.public.Delivery.where({ orderId: timeoutOrder })
        .first();
      expect(timedDelivery?.status).toBe('SEARCHING_DRIVER');
      expect(
        await prisma
          .getDb()
          .orm.public.Delivery.where({ orderId: timeoutOrder })
          .all(),
      ).toHaveLength(1);

      const concurrent1 = await addReadyOrder();
      const concurrent2 = await addReadyOrder();
      const [raceOne, raceTwo] = await Promise.all([
        matching.startForReadyOrder(concurrent1),
        matching.startForReadyOrder(concurrent2),
      ]);
      const aOffers = [raceOne, raceTwo].filter(
        (row) => row.assignment?.driverId === driverA && row.offered,
      );
      expect(aOffers).toHaveLength(1);
      const otherRace = [raceOne, raceTwo].find(
        (row) => row.deliveryId !== aOffers[0].deliveryId,
      );
      expect(otherRace?.assignment?.driverId).not.toBe(driverA);
      const openForA = await prisma
        .getDb()
        .orm.public.DriverAssignment.where({
          driverId: driverA,
          releasedAt: null,
        })
        .all();
      expect(openForA).toHaveLength(1);
      await matching.reject(
        (await authMe(tokenA)).id,
        aOffers[0].assignment!.id,
      );
      if (otherRace && !otherRace.offered) {
        const takeOther = await matching.matchDelivery(otherRace.deliveryId);
        if (takeOther.assignment?.driverId === driverA) {
          await matching.reject(
            (await authMe(tokenA)).id,
            takeOther.assignment.id,
          );
        }
      }

      const acceptTimeoutOrder = await addReadyOrder();
      const beforeTimeout =
        await matching.startForReadyOrder(acceptTimeoutOrder);
      expect(beforeTimeout.assignment?.driverId).toBe(driverA);
      const acceptedBeforeTimeout = await request(server)
        .post(
          `/api/v1/driver/assignments/${beforeTimeout.assignment!.id}/accept`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(acceptedBeforeTimeout.status).toBe(200);
      await processor.process({
        name: MATCHING_JOB_TIMEOUT,
        data: { assignmentId: beforeTimeout.assignment!.id },
      } as never);
      const stillAccepted = await prisma
        .getDb()
        .orm.public.DriverAssignment.where({
          id: beforeTimeout.assignment!.id,
        })
        .first();
      expect(stillAccepted?.status).toBe('ACCEPTED');
      const stillAssigned = await prisma
        .getDb()
        .orm.public.Delivery.where({ orderId: acceptTimeoutOrder })
        .first();
      expect(stillAssigned?.status).toBe('DRIVER_ASSIGNED');

      const customerRead = await request(server)
        .get(`/api/v1/customer/orders/${orderId}/delivery`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(customerRead.status).toBe(200);
      expect(
        (customerRead.body as { assignedDriverId: string | null })
          .assignedDriverId,
      ).toBe(driverB);
      expect(JSON.stringify(customerRead.body)).not.toContain('license');
    } finally {
      if (e164[0]) {
        await cleanupByPhone(e164[0]);
      }
      for (const id of adminIds) {
        const rules = await prisma
          .getDb()
          .orm.public.MerchantCommissionRule.where({ changedByAdminId: id })
          .all();
        for (const rule of rules) {
          await prisma
            .getDb()
            .orm.public.MerchantCommissionRule.where({ id: rule.id })
            .delete();
        }
        await prisma.getDb().orm.public.AdminProfile.where({ id }).delete();
      }
      for (const id of roleIds) {
        await prisma.getDb().orm.public.Role.where({ id }).delete();
      }
      for (const zoneId of zoneIds) {
        const rules = await prisma
          .getDb()
          .orm.public.DeliveryPricingRule.where({ zoneId })
          .all();
        for (const rule of rules) {
          await prisma
            .getDb()
            .orm.public.DeliveryPricingRule.where({ id: rule.id })
            .delete();
        }
        await prisma
          .getDb()
          .orm.public.DeliveryZone.where({ id: zoneId })
          .delete();
      }
      for (const phone of e164.slice(1)) {
        await cleanupByPhone(phone);
      }
      const leftover = await redis.getClient().keys('matching:test:*');
      if (leftover.length > 0) {
        await redis.getClient().del(...leftover);
      }
      const bullKeys = await redis.getClient().keys('bull:matching:test*');
      if (bullKeys.length > 0) {
        await redis.getClient().del(...bullKeys);
      }
    }
  });
});
