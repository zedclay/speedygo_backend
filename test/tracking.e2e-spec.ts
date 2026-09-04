import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import jwt from 'jsonwebtoken';
import { io, type Socket } from 'socket.io-client';
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
import { attachRedisIoAdapter } from '../src/infrastructure/realtime/redis-io.adapter';
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
import {
  TRACKING_EVENT_LOCATION,
  TRACKING_EVENT_LOCATION_UPDATE,
  TRACKING_EVENT_SUBSCRIBE,
  TRACKING_NAMESPACE,
} from '../src/modules/tracking/domain/tracking.events';

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
const INSIDE: [number, number] = [36.75, 3.05];
const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

describe('Realtime tracking (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let matching: MatchingService;
  let review: DriverReviewService;
  let locations: DriverLocationStore;
  let queue: Queue;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    attachRedisIoAdapter(app);
    await app.listen(0);
    baseUrl = await app.getUrl();
    sender = app.get(OTP_SENDER);
    prisma = app.get(PrismaService);
    await deactivateAllDeliveryZones(prisma);
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
      'socket.io:tracking:test*',
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

  function connectTracking(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}${TRACKING_NAMESPACE}`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
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

  function emitAck<T>(
    socket: Socket,
    event: string,
    payload?: unknown,
  ): Promise<T> {
    return new Promise((resolve) => {
      socket.emit(event, payload ?? {}, (ack: T) => resolve(ack));
    });
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function signShortAccess(token: string, expiresInSeconds: number): string {
    const decoded = jwt.decode(token) as { sub: string; sid: string };
    return jwt.sign(
      { sid: decoded.sid, typ: 'access' },
      process.env.JWT_ACCESS_SECRET as string,
      { subject: decoded.sub, expiresIn: expiresInSeconds },
    );
  }

  function waitEvent<T>(
    socket: Socket,
    event: string,
    timeoutMs = 4000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for ${event}`)),
        timeoutMs,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
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

  it('ingests location, authorizes tracking rooms, and keeps Matching store in sync', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0571${suffix}`,
      owner: `0572${suffix}`,
      driverA: `0573${suffix}`,
      driverB: `0574${suffix}`,
      staff: `0575${suffix}`,
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
      const tokenStaff = await authenticate(phones.staff);
      const accountCustomer = await authMe(tokenCustomer);
      const accountOwner = await authMe(tokenOwner);
      const accountStaff = await authMe(tokenStaff);
      e164.push(
        accountCustomer.phone,
        accountOwner.phone,
        (await authMe(tokenA)).phone,
        (await authMe(tokenB)).phone,
        (await authMe(tokenStaff)).phone,
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
      await prisma.getDb().orm.public.MerchantMember.create({
        id: createUuidV7(),
        merchantId,
        accountId: accountStaff.id,
        role: pgVarchar<64>('STAFF'),
        createdAt: pgNow(),
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

      const unauth = io(`${baseUrl}${TRACKING_NAMESPACE}`, {
        transports: ['websocket'],
        forceNew: true,
      });
      const unauthError = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('unauth timeout')),
          4000,
        );
        unauth.on('tracking:error', (payload: { code: string }) => {
          clearTimeout(timer);
          resolve(payload.code);
        });
        unauth.on('connect_error', () => {
          clearTimeout(timer);
          resolve('AUTH_INVALID_TOKEN');
        });
      });
      expect(['AUTH_INVALID_TOKEN', 'TRACKING_UNAUTHORIZED']).toContain(
        unauthError,
      );
      unauth.disconnect();

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

      const searchingOrder = await addReadyOrder();
      const noLoc = await matching.startForReadyOrder(searchingOrder);
      expect(noLoc.offered).toBe(false);
      const published = await request(server)
        .post('/api/v1/driver/location')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ latitude: 36.7504, longitude: 3.0504 });
      expect(published.status).toBe(200);
      expect((published.body as { broadcast: boolean }).broadcast).toBe(false);
      await sleep(1100);
      const stored = await locations.get(driverA);
      expect(stored).toBeTruthy();
      const nowMatchable = await matching.startForReadyOrder(searchingOrder);
      expect(nowMatchable.offered).toBe(true);
      expect(nowMatchable.assignment?.driverId).toBe(driverA);
      const searchingTrack = await request(server)
        .get(`/api/v1/customer/orders/${searchingOrder}/tracking`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchingTrack.status).toBe(200);
      expect((searchingTrack.body as { status: string }).status).toBe(
        'NO_DRIVER',
      );
      expect(
        (searchingTrack.body as { location: unknown }).location,
      ).toBeNull();
      const customerSearchSocket = await connectTracking(tokenCustomer);
      const searchSub = await emitAck<{
        ok: boolean;
        snapshot?: { status: string };
      }>(customerSearchSocket, TRACKING_EVENT_SUBSCRIBE, {
        orderId: searchingOrder,
      });
      expect(searchSub.ok).toBe(true);
      expect(searchSub.snapshot?.status).toBe('NO_DRIVER');
      let leaked = false;
      customerSearchSocket.on(TRACKING_EVENT_LOCATION, () => {
        leaked = true;
      });
      const driverASocketEarly = await connectTracking(tokenA);
      await sleep(1100);
      await emitAck(driverASocketEarly, TRACKING_EVENT_LOCATION_UPDATE, {
        latitude: 36.751,
        longitude: 3.051,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(leaked).toBe(false);
      customerSearchSocket.disconnect();
      driverASocketEarly.disconnect();
      await matching.reject(
        (await authMe(tokenA)).id,
        nowMatchable.assignment!.id,
      );
      await queue.obliterate({ force: true });

      await locations.upsert(
        driverA,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      await locations.upsert(driverB, 36.753, 3.053, new Date().toISOString());

      const assignedOrder = await addReadyOrder();
      const offered = await matching.startForReadyOrder(assignedOrder);
      expect(offered.assignment?.driverId).toBe(driverA);
      const accepted = await request(server)
        .post(`/api/v1/driver/assignments/${offered.assignment!.id}/accept`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(accepted.status).toBe(200);
      await queue.obliterate({ force: true });

      let customerSocket = await connectTracking(tokenCustomer);
      const customerSub = await emitAck<{
        ok: boolean;
        snapshot?: { status: string; assignedDriverId: string | null };
      }>(customerSocket, TRACKING_EVENT_SUBSCRIBE, { orderId: assignedOrder });
      expect(customerSub.ok).toBe(true);
      expect(customerSub.snapshot?.assignedDriverId).toBe(driverA);
      const merchantSocket = await connectTracking(tokenOwner);
      const merchantSub = await emitAck<{ ok: boolean }>(
        merchantSocket,
        TRACKING_EVENT_SUBSCRIBE,
        { orderId: assignedOrder, merchantId },
      );
      expect(merchantSub.ok).toBe(true);
      const foreignCustomerToken = tokenB;
      const foreignSocket = await connectTracking(foreignCustomerToken);
      const foreignSub = await emitAck<{
        ok: boolean;
        error?: { code: string };
      }>(foreignSocket, TRACKING_EVENT_SUBSCRIBE, { orderId: assignedOrder });
      expect(foreignSub.ok).toBe(false);

      const customerLoc = waitEvent<{
        latitude: number;
        assignedDriverId: string;
      }>(customerSocket, TRACKING_EVENT_LOCATION);
      const merchantLoc = waitEvent<{ latitude: number }>(
        merchantSocket,
        TRACKING_EVENT_LOCATION,
      );
      const driverSocket = await connectTracking(tokenA);
      await sleep(1100);
      const locAck = await emitAck<{ ok: boolean }>(
        driverSocket,
        TRACKING_EVENT_LOCATION_UPDATE,
        { latitude: 36.752, longitude: 3.052 },
      );
      expect(locAck.ok).toBe(true);
      const received = await customerLoc;
      expect(received.assignedDriverId).toBe(driverA);
      expect(received.latitude).toBeCloseTo(36.752, 3);
      await merchantLoc;
      expect(JSON.stringify(received)).not.toContain(accountCustomer.phone);
      expect(JSON.stringify(received)).not.toContain('300');

      const httpImmediate = await request(server)
        .post('/api/v1/driver/location')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ latitude: 36.752, longitude: 3.052 });
      expect(httpImmediate.status).toBe(429);
      await sleep(1100);
      const socketThenOk = await emitAck<{ ok: boolean }>(
        driverSocket,
        TRACKING_EVENT_LOCATION_UPDATE,
        { latitude: 36.752, longitude: 3.052 },
      );
      expect(socketThenOk.ok).toBe(true);
      const httpAfterInterval = await request(server)
        .post('/api/v1/driver/location')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ latitude: 36.752, longitude: 3.052 });
      expect(httpAfterInterval.status).toBe(429);

      const expiring = await connectTracking(signShortAccess(tokenCustomer, 1));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('token expiry disconnect timeout')),
          2500,
        );
        expiring.on('disconnect', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      const afterExpiry = await connectTracking(tokenCustomer);
      afterExpiry.disconnect();

      const staffSocket = await connectTracking(tokenStaff);
      const staffSub = await emitAck<{ ok: boolean }>(
        staffSocket,
        TRACKING_EVENT_SUBSCRIBE,
        { orderId: assignedOrder, merchantId },
      );
      expect(staffSub.ok).toBe(true);
      const staffMember = await prisma
        .getDb()
        .orm.public.MerchantMember.where({
          merchantId,
          accountId: accountStaff.id,
        })
        .first();
      expect(staffMember).toBeTruthy();
      await prisma
        .getDb()
        .orm.public.MerchantMember.where({ id: staffMember!.id })
        .delete();
      await sleep(400);
      let staffLeaked = false;
      staffSocket.on(TRACKING_EVENT_LOCATION, () => {
        staffLeaked = true;
      });
      await sleep(1100);
      await emitAck(driverSocket, TRACKING_EVENT_LOCATION_UPDATE, {
        latitude: 36.7521,
        longitude: 3.0521,
      });
      await sleep(250);
      expect(staffLeaked).toBe(false);
      staffSocket.disconnect();

      const driverSub = await emitAck<{ ok: boolean }>(
        driverSocket,
        TRACKING_EVENT_SUBSCRIBE,
        {},
      );
      expect(driverSub.ok).toBe(true);

      customerSocket.disconnect();
      const customerReconnected = await connectTracking(tokenCustomer);
      const resub = await emitAck<{ ok: boolean }>(
        customerReconnected,
        TRACKING_EVENT_SUBSCRIBE,
        { orderId: assignedOrder },
      );
      expect(resub.ok).toBe(true);
      customerSocket = customerReconnected;

      const httpTrack = await request(server)
        .get(`/api/v1/customer/orders/${assignedOrder}/tracking`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(httpTrack.status).toBe(200);
      expect((httpTrack.body as { status: string }).status).toBe('LIVE');
      const merchantTrack = await request(server)
        .get(`/api/v1/merchant/${merchantId}/orders/${assignedOrder}/tracking`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(merchantTrack.status).toBe(200);
      expect(
        (merchantTrack.body as { assignedDriverId: string }).assignedDriverId,
      ).toBe(driverA);

      await locations.upsert(
        driverA,
        36.752,
        3.052,
        '2020-01-01T00:00:00.000Z',
      );
      const staleTrack = await request(server)
        .get(`/api/v1/customer/orders/${assignedOrder}/tracking`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect((staleTrack.body as { status: string }).status).toBe('STALE');
      expect((staleTrack.body as { location: unknown }).location).toBeNull();
      const assignment = await prisma
        .getDb()
        .orm.public.DriverAssignment.where({ id: offered.assignment!.id })
        .first();
      expect(assignment?.status).toBe('ACCEPTED');
      const delivery = await prisma
        .getDb()
        .orm.public.Delivery.where({ orderId: assignedOrder })
        .first();
      expect(delivery?.status).toBe('DRIVER_ASSIGNED');
      const orderRow = await prisma
        .getDb()
        .orm.public.Order.where({ id: assignedOrder })
        .first();
      expect(orderRow?.status).toBe('ACTIVE');
      expect(orderRow?.fulfillmentStatus).toBe('READY');
      const availability = await prisma
        .getDb()
        .orm.public.DriverAvailability.where({ driverId: driverA })
        .first();
      expect(availability?.status).toBe('ONLINE');

      const wentOffline = await request(server)
        .post('/api/v1/driver/availability/go-offline')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(wentOffline.status).toBe(200);
      expect(
        (wentOffline.body as { availability: { status: string } }).availability
          .status,
      ).toBe('OFFLINE_AFTER_CURRENT_DELIVERY');
      await sleep(1100);
      const stillPublishes = await request(server)
        .post('/api/v1/driver/location')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ latitude: 36.7522, longitude: 3.0522 });
      expect(stillPublishes.status).toBe(200);
      expect((stillPublishes.body as { broadcast: boolean }).broadcast).toBe(
        true,
      );
      const afterOfflineAvail = await prisma
        .getDb()
        .orm.public.DriverAvailability.where({ driverId: driverA })
        .first();
      expect(afterOfflineAvail?.status).toBe('OFFLINE_AFTER_CURRENT_DELIVERY');

      await review.suspend(driverA);
      const suspended = await request(server)
        .post('/api/v1/driver/location')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ latitude: 36.75, longitude: 3.05 });
      expect(suspended.status).toBe(409);

      const secondOrder = await addReadyOrder();
      await locations.upsert(driverB, 36.753, 3.053, new Date().toISOString());
      const second = await matching.startForReadyOrder(secondOrder);
      expect(second.assignment?.driverId).toBe(driverB);
      await request(server)
        .post(`/api/v1/driver/assignments/${second.assignment!.id}/accept`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({});
      const customerBSocket = await connectTracking(tokenB);
      const subB = await emitAck<{ ok: boolean }>(
        customerBSocket,
        TRACKING_EVENT_SUBSCRIBE,
        { orderId: secondOrder },
      );
      expect(subB.ok).toBe(false);
      let isolated = false;
      customerSocket.on(TRACKING_EVENT_LOCATION, () => {
        isolated = true;
      });
      const driverBSocket = await connectTracking(tokenB);
      await sleep(1100);
      await emitAck(driverBSocket, TRACKING_EVENT_LOCATION_UPDATE, {
        latitude: 36.76,
        longitude: 3.06,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(isolated).toBe(false);

      await prisma
        .getDb()
        .orm.public.DriverAssignment.where({ id: offered.assignment!.id })
        .update({ releasedAt: pgNow() });
      await prisma
        .getDb()
        .orm.public.DriverAssignment.where({ id: second.assignment!.id })
        .update({ releasedAt: pgNow() });
      await sleep(400);
      await prisma.getDb().orm.public.DriverAssignment.create({
        id: createUuidV7(),
        deliveryId: delivery!.id,
        driverId: driverB,
        status: pgVarchar<64>('ACCEPTED'),
        assignedAt: pgNow(),
        acceptedAt: pgNow(),
        releasedAt: null,
      });
      let oldDriverLeaked = false;
      driverSocket.on(TRACKING_EVENT_LOCATION, () => {
        oldDriverLeaked = true;
      });
      await sleep(1100);
      await emitAck(driverBSocket, TRACKING_EVENT_LOCATION_UPDATE, {
        latitude: 36.761,
        longitude: 3.061,
      });
      await sleep(250);
      expect(oldDriverLeaked).toBe(false);

      const logout = await request(server)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({});
      expect(logout.status).toBe(200);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('session revocation disconnect timeout')),
          1500,
        );
        driverBSocket.on('disconnect', () => {
          clearTimeout(timer);
          resolve();
        });
      });

      customerSocket.disconnect();
      merchantSocket.disconnect();
      foreignSocket.disconnect();
      driverSocket.disconnect();
      customerBSocket.disconnect();
      driverBSocket.disconnect();
      await queue.obliterate({ force: true });
    } finally {
      await queue.obliterate({ force: true });
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
      for (const pattern of [
        'matching:test:*',
        'bull:matching:test*',
        'tracking:test:*',
        'socket.io:tracking:test*',
      ]) {
        const leftover = await redis.getClient().keys(pattern);
        if (leftover.length > 0) {
          await redis.getClient().del(...leftover);
        }
      }
    }
  });
});
