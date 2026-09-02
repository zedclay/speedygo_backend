import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createUuidV7 } from '../src/common/utils/uuid-v7';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { PrismaService } from '../src/infrastructure/database/database.module';
import {
  pgBigInt,
  pgDate,
  pgNow,
  pgTimestamptz,
  pgVarchar,
} from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { DriverReviewService } from '../src/modules/drivers/application/driver-review.service';
import { MatchingService } from '../src/modules/matching/application/matching.service';
import { MATCHING_QUEUE_NAME } from '../src/modules/matching/domain/matching.jobs';
import { MatchingProcessor } from '../src/modules/matching/infrastructure/matching.processor';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '../src/modules/matching/domain/matching.types';

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
type DriverDeliveryBody = {
  assignmentId: string;
  deliveryId: string;
  orderId: string;
  deliveryStatus: string;
  orderStatus: string;
  fulfillmentStatus: string;
  assignmentStatus: string;
  allowedActions: string[];
};
type ErrorBody = { error: { code: string } };

const INSIDE: [number, number] = [36.75, 3.05];
const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];
const LOGISTICS_ACTIONS = [
  'start-to-pickup',
  'arrive-pickup',
  'confirm-pickup',
  'start-delivery',
  'arrive-customer',
] as const;

describe('Driver Delivery Workflow (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let matching: MatchingService;
  let review: DriverReviewService;
  let locations: DriverLocationStore;
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
    redis = app.get(RedisService);
    matching = app.get(MatchingService);
    review = app.get(DriverReviewService);
    locations = app.get(DRIVER_LOCATION_STORE);
    queue = app.get<Queue>(getQueueToken(MATCHING_QUEUE_NAME));
    await queue.obliterate({ force: true });
    for (const pattern of [
      'auth:test:*',
      'matching:test:*',
      'bull:matching:test*',
      'tracking:test:*',
    ]) {
      const leftover = await redis.getClient().keys(pattern);
      if (leftover.length > 0) {
        await redis.getClient().del(...leftover);
      }
    }
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.get(MatchingProcessor).worker.close();
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
        deviceName: 'driver-delivery-e2e',
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
    expect(submitted.status).toBe(200);
    const driverId = (submitted.body as { profile: { id: string } }).profile.id;
    await review.approve(driverId);
    await request(server)
      .post('/api/v1/driver/availability/go-online')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    return driverId;
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
      const collections = await prisma
        .getDb()
        .orm.public.CodCollection.where({ driverId: driver.id })
        .all();
      for (const row of collections) {
        await prisma
          .getDb()
          .orm.public.CodCollection.where({ id: row.id })
          .delete();
      }
      const earnings = await prisma
        .getDb()
        .orm.public.DriverEarning.where({ driverId: driver.id })
        .all();
      for (const row of earnings) {
        await prisma
          .getDb()
          .orm.public.DriverEarning.where({ id: row.id })
          .delete();
      }
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
          const proof = await prisma
            .getDb()
            .orm.public.DeliveryProof.where({ deliveryId: delivery.id })
            .first();
          if (proof) {
            await prisma
              .getDb()
              .orm.public.DeliveryProof.where({ id: proof.id })
              .delete();
          }
          const leftoverEarnings = await prisma
            .getDb()
            .orm.public.DriverEarning.where({ deliveryId: delivery.id })
            .all();
          for (const row of leftoverEarnings) {
            await prisma
              .getDb()
              .orm.public.DriverEarning.where({ id: row.id })
              .delete();
          }
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
        const collections = await prisma
          .getDb()
          .orm.public.CodCollection.where({ orderId: order.id })
          .all();
        for (const row of collections) {
          await prisma
            .getDb()
            .orm.public.CodCollection.where({ id: row.id })
            .delete();
        }
        const payments = await prisma
          .getDb()
          .orm.public.Payment.where({ orderId: order.id })
          .all();
        for (const payment of payments) {
          const txs = await prisma
            .getDb()
            .orm.public.PaymentTransaction.where({ paymentId: payment.id })
            .all();
          for (const tx of txs) {
            await prisma
              .getDb()
              .orm.public.PaymentTransaction.where({ id: tx.id })
              .delete();
          }
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

  async function countFinancials(orderId: string, deliveryId: string) {
    const [cod, earnings, txs, proofs] = await Promise.all([
      prisma.getDb().orm.public.CodCollection.where({ orderId }).all(),
      prisma.getDb().orm.public.DriverEarning.where({ deliveryId }).all(),
      prisma.getDb().orm.public.Payment.where({ orderId }).all(),
      prisma.getDb().orm.public.DeliveryProof.where({ deliveryId }).all(),
    ]);
    const paymentIds = txs.map((row) => row.id);
    const transactions =
      paymentIds.length === 0
        ? []
        : (
            await Promise.all(
              paymentIds.map((paymentId) =>
                prisma
                  .getDb()
                  .orm.public.PaymentTransaction.where({ paymentId })
                  .all(),
              ),
            )
          ).flat();
    return {
      cod: cod.length,
      earnings: earnings.length,
      transactions: transactions.length,
      proofs: proofs.length,
    };
  }

  it('runs COD logistics through ARRIVED_CUSTOMER and blocks completion', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0581${suffix}`,
      owner: `0582${suffix}`,
      driverA: `0583${suffix}`,
      driverB: `0584${suffix}`,
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
        .send({ fullName: 'Workflow Customer' });
      const home = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          label: 'Home',
          addressText: 'Dropoff 12',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const homeId = (home.body as AddressBody).id;
      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Workflow Cafe' });
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
        name: pgVarchar<255>(`Workflow zone ${suffix}`),
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
        name: pgVarchar<128>(`wf-e2e-${suffix}`),
        description: null,
        active: true,
      });
      roleIds.push(roleId);
      const adminId = createUuidV7();
      await prisma.getDb().orm.public.AdminProfile.create({
        id: adminId,
        accountId: accountOwner.id,
        roleId,
        displayName: pgVarchar<255>('Workflow Admin'),
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

      async function addReadyOrder(
        paymentMethod: 'COD' | 'ELECTRONIC',
      ): Promise<string> {
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
            paymentMethod,
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
        if (paymentMethod === 'ELECTRONIC') {
          await prisma
            .getDb()
            .orm.public.Payment.where({ orderId })
            .update({ status: 'SUCCEEDED', updatedAt: pgNow() });
        }
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
        'Assigned Driver',
        `WA${suffix}`,
      );
      const driverB = await onboardApprovedDriver(
        tokenB,
        'Foreign Driver',
        `WB${suffix}`,
      );
      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      await locations.upsert(driverB, 36.79, 3.09, new Date().toISOString());

      const codOrder = await addReadyOrder('COD');
      const offered = await matching.startForReadyOrder(codOrder);
      expect(offered.assignment?.driverId).toBe(driverA);
      const accepted = await request(server)
        .post(`/api/v1/driver/assignments/${offered.assignment!.id}/accept`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(accepted.status).toBe(200);

      const current = await request(server)
        .get('/api/v1/driver/deliveries/current')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(current.status).toBe(200);
      expect(
        (current.body as { delivery: DriverDeliveryBody }).delivery
          .deliveryStatus,
      ).toBe('DRIVER_ASSIGNED');
      expect(
        (current.body as { delivery: DriverDeliveryBody }).delivery
          .allowedActions,
      ).toEqual(['start-to-pickup']);
      const deliveryId = (current.body as { delivery: DriverDeliveryBody })
        .delivery.deliveryId;

      const skip = await request(server)
        .post('/api/v1/driver/deliveries/current/arrive-customer')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(skip.status).toBe(409);
      expect((skip.body as ErrorBody).error.code).toBe(
        'DRIVER_DELIVERY_INVALID_STATE',
      );

      const foreign = await request(server)
        .post('/api/v1/driver/deliveries/current/start-to-pickup')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({});
      expect(foreign.status).toBe(409);
      expect((foreign.body as ErrorBody).error.code).toBe(
        'DRIVER_DELIVERY_ASSIGNMENT_NOT_ACTIVE',
      );

      const started = await request(server)
        .post('/api/v1/driver/deliveries/current/start-to-pickup')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(started.status).toBe(200);
      expect((started.body as DriverDeliveryBody).deliveryStatus).toBe(
        'TO_PICKUP',
      );
      await locations.upsert(driverA, 36.8, 3.1, new Date().toISOString());
      const farPickup = await request(server)
        .post('/api/v1/driver/deliveries/current/arrive-pickup')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(farPickup.status).toBe(409);
      expect((farPickup.body as ErrorBody).error.code).toBe(
        'DRIVER_DELIVERY_NOT_NEAR_PICKUP',
      );
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Delivery.where({ id: deliveryId })
            .first()
        )?.status,
      ).toBe('TO_PICKUP');
      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      const arrivedPickup = await request(server)
        .post('/api/v1/driver/deliveries/current/arrive-pickup')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(arrivedPickup.status).toBe(200);
      expect((arrivedPickup.body as DriverDeliveryBody).deliveryStatus).toBe(
        'AT_PICKUP',
      );
      const replayPickup = await request(server)
        .post('/api/v1/driver/deliveries/current/arrive-pickup')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(replayPickup.status).toBe(409);

      await review.suspend(driverA);
      const afterSuspend = await request(server)
        .post('/api/v1/driver/deliveries/current/confirm-pickup')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(afterSuspend.status).toBe(200);
      expect((afterSuspend.body as DriverDeliveryBody).deliveryStatus).toBe(
        'PICKED_UP',
      );
      const startedLeg = await request(server)
        .post('/api/v1/driver/deliveries/current/start-delivery')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(startedLeg.status).toBe(200);

      await locations.upsert(driverA, 36.8, 3.1, new Date().toISOString());
      const farDropoff = await request(server)
        .post('/api/v1/driver/deliveries/current/arrive-customer')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(farDropoff.status).toBe(409);
      expect((farDropoff.body as ErrorBody).error.code).toBe(
        'DRIVER_DELIVERY_NOT_NEAR_DROPOFF',
      );
      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      const arrivedCustomer = await request(server)
        .post('/api/v1/driver/deliveries/current/arrive-customer')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(arrivedCustomer.status).toBe(200);
      expect((arrivedCustomer.body as DriverDeliveryBody).deliveryStatus).toBe(
        'ARRIVED_CUSTOMER',
      );
      expect((arrivedCustomer.body as DriverDeliveryBody).orderStatus).toBe(
        'ACTIVE',
      );
      expect(
        (arrivedCustomer.body as DriverDeliveryBody).fulfillmentStatus,
      ).toBe('READY');

      await locations.upsert(driverA, 36.751, 3.051, new Date().toISOString());
      const afterPickupLocation = await request(server)
        .post('/api/v1/driver/location')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ latitude: 36.751, longitude: 3.051 });
      expect(afterPickupLocation.status).toBe(409);
      const stillArrived = await prisma
        .getDb()
        .orm.public.Delivery.where({ id: deliveryId })
        .first();
      expect(stillArrived?.status).toBe('ARRIVED_CUSTOMER');

      const customerRead = await request(server)
        .get(`/api/v1/customer/orders/${codOrder}/delivery`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(customerRead.status).toBe(200);
      expect((customerRead.body as { status: string }).status).toBe(
        'ARRIVED_CUSTOMER',
      );
      expect(JSON.stringify(customerRead.body)).not.toContain('0550123499');
      const merchantRead = await request(server)
        .get(`/api/v1/merchant/${merchantId}/orders/${codOrder}/delivery`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(merchantRead.status).toBe(200);
      expect((merchantRead.body as { status: string }).status).toBe(
        'ARRIVED_CUSTOMER',
      );

      const tracking = await request(server)
        .get(`/api/v1/customer/orders/${codOrder}/tracking`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(tracking.status).toBe(200);
      expect(
        (tracking.body as { driverAssigned: boolean }).driverAssigned,
      ).toBe(true);
      expect((tracking.body as { status: string }).status).not.toBe(
        'NO_DRIVER',
      );

      const blocked = await request(server)
        .post('/api/v1/driver/deliveries/current/complete-delivery')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(blocked.status).toBe(409);
      expect((blocked.body as ErrorBody).error.code).toBe(
        'DRIVER_DELIVERY_COD_COMPLETION_NOT_READY',
      );
      const afterBlock = await prisma
        .getDb()
        .orm.public.Delivery.where({ id: deliveryId })
        .first();
      expect(afterBlock?.status).toBe('ARRIVED_CUSTOMER');
      const assignment = await prisma
        .getDb()
        .orm.public.DriverAssignment.where({ deliveryId })
        .first();
      expect(assignment?.status).toBe('ACCEPTED');
      expect(assignment?.releasedAt).toBeNull();
      const financials = await countFinancials(codOrder, deliveryId);
      expect(financials.cod).toBe(0);
      expect(financials.earnings).toBe(0);
      expect(financials.transactions).toBe(0);
      expect(financials.proofs).toBe(0);

      const events = await prisma
        .getDb()
        .orm.public.DeliveryEvent.where({ deliveryId })
        .all();
      const types = events.map((event) => event.type);
      expect(
        types.filter((type) => type === 'DRIVER_STARTED_TO_PICKUP'),
      ).toHaveLength(1);
      expect(
        types.filter((type) => type === 'DRIVER_ARRIVED_CUSTOMER'),
      ).toHaveLength(1);
      expect(types).not.toContain('DELIVERY_COMPLETED');
      expect(
        events.every((event) => !event.driverId || event.driverId === driverA),
      ).toBe(true);

      const electronicOrder = await addReadyOrder('ELECTRONIC');
      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      const secondOffer = await matching.startForReadyOrder(electronicOrder);
      expect(secondOffer.offered).toBe(false);
      const suspendedAvailability = await prisma
        .getDb()
        .orm.public.DriverAvailability.where({ driverId: driverA })
        .first();
      expect(suspendedAvailability?.status).toBe('SUSPENDED');
      const assignmentStillOpen = await prisma
        .getDb()
        .orm.public.DriverAssignment.where({ deliveryId })
        .first();
      expect(assignmentStillOpen?.status).toBe('ACCEPTED');
      expect(assignmentStillOpen?.releasedAt).toBeNull();
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
      for (const id of zoneIds) {
        const rules = await prisma
          .getDb()
          .orm.public.DeliveryPricingRule.where({ zoneId: id })
          .all();
        for (const rule of rules) {
          await prisma
            .getDb()
            .orm.public.DeliveryPricingRule.where({ id: rule.id })
            .delete();
        }
        await prisma.getDb().orm.public.DeliveryZone.where({ id }).delete();
      }
      for (const phone of e164.slice(1)) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('completes ELECTRONIC delivery, releases assignment, and enforces concurrency', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}9`;
    const phones = {
      customer: `0591${suffix}`,
      owner: `0592${suffix}`,
      driverA: `0593${suffix}`,
    };
    const e164: string[] = [];
    const zoneIds: string[] = [];
    const adminIds: string[] = [];
    const roleIds: string[] = [];
    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenOwner = await authenticate(phones.owner);
      const tokenA = await authenticate(phones.driverA);
      const accountCustomer = await authMe(tokenCustomer);
      const accountOwner = await authMe(tokenOwner);
      e164.push(
        accountCustomer.phone,
        accountOwner.phone,
        (await authMe(tokenA)).phone,
      );

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'Electronic Customer' });
      const home = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          label: 'Home',
          addressText: 'Dropoff 9',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const homeId = (home.body as AddressBody).id;
      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Electronic Cafe' });
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'Main',
          phone: '0550123400',
          addressText: 'Street B',
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
        .send({ branchId, name: 'Food' });
      const product = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          branchId,
          categoryId: (category.body as CategoryBody).id,
          name: 'Coffee',
          priceMinor: 800,
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
        .send({ name: 'Regular', additionalPriceMinor: 0 });
      const largeId = (large.body as OptionBody).id;
      const zoneId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Elec zone ${suffix}`),
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
        name: pgVarchar<128>(`elec-e2e-${suffix}`),
        description: null,
        active: true,
      });
      roleIds.push(roleId);
      const adminId = createUuidV7();
      await prisma.getDb().orm.public.AdminProfile.create({
        id: adminId,
        accountId: accountOwner.id,
        roleId,
        displayName: pgVarchar<255>('Electronic Admin'),
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
            paymentMethod: 'ELECTRONIC',
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
        await prisma
          .getDb()
          .orm.public.Payment.where({ orderId })
          .update({ status: 'SUCCEEDED', updatedAt: pgNow() });
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
        'Electronic Driver',
        `EA${suffix}`,
      );
      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      const firstOrder = await addReadyOrder();
      const firstOffer = await matching.startForReadyOrder(firstOrder);
      expect(firstOffer.assignment?.driverId).toBe(driverA);
      await request(server)
        .post(`/api/v1/driver/assignments/${firstOffer.assignment!.id}/accept`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      for (const action of LOGISTICS_ACTIONS) {
        if (action === 'arrive-pickup' || action === 'arrive-customer') {
          await locations.upsert(
            driverA,
            36.7504,
            3.0504,
            new Date().toISOString(),
          );
        }
        const step = await request(server)
          .post(`/api/v1/driver/deliveries/current/${action}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({});
        expect(step.status).toBe(200);
      }
      const current = await request(server)
        .get('/api/v1/driver/deliveries/current')
        .set('Authorization', `Bearer ${tokenA}`);
      const deliveryId = (current.body as { delivery: DriverDeliveryBody })
        .delivery.deliveryId;
      const paymentBefore = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: firstOrder })
        .first();

      const [completeA, completeB] = await Promise.all([
        request(server)
          .post('/api/v1/driver/deliveries/current/complete-delivery')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({}),
        request(server)
          .post('/api/v1/driver/deliveries/current/complete-delivery')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({}),
      ]);
      const statuses = [completeA.status, completeB.status].sort();
      expect(statuses).toEqual([200, 409]);
      const winner = completeA.status === 200 ? completeA : completeB;
      expect((winner.body as DriverDeliveryBody).deliveryStatus).toBe(
        'DELIVERED',
      );
      expect((winner.body as DriverDeliveryBody).orderStatus).toBe('COMPLETED');
      expect((winner.body as DriverDeliveryBody).fulfillmentStatus).toBe(
        'READY',
      );
      expect((winner.body as DriverDeliveryBody).assignmentStatus).toBe(
        'RELEASED',
      );
      const completedEvents = await prisma
        .getDb()
        .orm.public.DeliveryEvent.where({
          deliveryId,
          type: pgVarchar<64>('DELIVERY_COMPLETED'),
        })
        .all();
      expect(completedEvents).toHaveLength(1);
      const orderCompleted = await prisma
        .getDb()
        .orm.public.OrderStatusEvent.where({
          orderId: firstOrder,
          eventType: pgVarchar<64>('ORDER_COMPLETED'),
        })
        .all();
      expect(orderCompleted).toHaveLength(1);
      expect(orderCompleted[0]?.actorType).toBe('DRIVER');
      const assignment = await prisma
        .getDb()
        .orm.public.DriverAssignment.where({ id: firstOffer.assignment!.id })
        .first();
      expect(assignment?.status).toBe('RELEASED');
      expect(assignment?.releasedAt).toBeTruthy();
      const order = await prisma
        .getDb()
        .orm.public.Order.where({ id: firstOrder })
        .first();
      expect(order?.status).toBe('COMPLETED');
      expect(order?.fulfillmentStatus).toBe('READY');
      expect(order?.completedAt).toBeTruthy();
      const paymentAfter = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: firstOrder })
        .first();
      expect(paymentAfter?.status).toBe(paymentBefore?.status);
      expect(paymentAfter?.method).toBe('ELECTRONIC');
      const financials = await countFinancials(firstOrder, deliveryId);
      expect(financials.cod).toBe(0);
      expect(financials.earnings).toBe(0);
      expect(financials.transactions).toBe(0);
      expect(financials.proofs).toBe(0);

      const after = await request(server)
        .get('/api/v1/driver/deliveries/current')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(after.status).toBe(200);
      expect((after.body as { delivery: null }).delivery).toBeNull();
      const tracking = await request(server)
        .get(`/api/v1/customer/orders/${firstOrder}/tracking`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(tracking.status).toBe(200);
      expect((tracking.body as { status: string }).status).toBe('NO_DRIVER');
      const availability = await prisma
        .getDb()
        .orm.public.DriverAvailability.where({ driverId: driverA })
        .first();
      expect(availability?.status).toBe('ONLINE');

      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      const secondOrder = await addReadyOrder();
      const secondOffer = await matching.startForReadyOrder(secondOrder);
      expect(secondOffer.offered).toBe(true);
      expect(secondOffer.assignment?.driverId).toBe(driverA);
      await request(server)
        .post(`/api/v1/driver/assignments/${secondOffer.assignment!.id}/accept`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      await prisma
        .getDb()
        .orm.public.DriverDocument.where({
          driverId: driverA,
          type: pgVarchar<64>('DRIVING_LICENSE'),
        })
        .update({
          expiryDate: pgDate('2000-01-01'),
          updatedAt: pgNow(),
        });
      const expiredMe = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(expiredMe.status).toBe(200);
      expect(
        (expiredMe.body as { operationalReady: boolean }).operationalReady,
      ).toBe(false);
      expect(
        (expiredMe.body as { matchingEligible: boolean }).matchingEligible,
      ).toBe(false);
      const offline = await request(server)
        .post('/api/v1/driver/availability/go-offline')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(offline.status).toBe(200);
      expect(
        (
          offline.body as {
            availability: { status: string };
          }
        ).availability.status,
      ).toBe('OFFLINE_AFTER_CURRENT_DELIVERY');
      for (const action of LOGISTICS_ACTIONS) {
        if (action === 'arrive-pickup' || action === 'arrive-customer') {
          await locations.upsert(
            driverA,
            36.7504,
            3.0504,
            new Date().toISOString(),
          );
        }
        const step = await request(server)
          .post(`/api/v1/driver/deliveries/current/${action}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({});
        expect(step.status).toBe(200);
      }
      const finished = await request(server)
        .post('/api/v1/driver/deliveries/current/complete-delivery')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(finished.status).toBe(200);
      const afterOffline = await prisma
        .getDb()
        .orm.public.DriverAvailability.where({ driverId: driverA })
        .first();
      expect(afterOffline?.status).toBe('OFFLINE');
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
      for (const id of zoneIds) {
        const rules = await prisma
          .getDb()
          .orm.public.DeliveryPricingRule.where({ zoneId: id })
          .all();
        for (const rule of rules) {
          await prisma
            .getDb()
            .orm.public.DeliveryPricingRule.where({ id: rule.id })
            .delete();
        }
        await prisma.getDb().orm.public.DeliveryZone.where({ id }).delete();
      }
      for (const phone of e164.slice(1)) {
        await cleanupByPhone(phone);
      }
    }
  });
});
