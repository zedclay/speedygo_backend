import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
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
import { CHECKOUT_CLOCK } from '../src/modules/checkout/domain/checkout.clock';
import { ISO_DAYS_OF_WEEK } from '../src/modules/merchants/domain/opening-hours.constants';
import { deactivateAllDeliveryZones } from './helpers/sanitize-delivery-zones';
import { deleteBranchOpeningHours } from './helpers/ensure-branch-opening-hours';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type AuthMeBody = { account: { id: string; phone: string } };
type MembershipBody = { merchantId: string };
type BranchBody = { id: string };
type CategoryBody = { id: string };
type ProductBody = { id: string };
type AddressBody = { id: string };
type OpeningHoursBody = {
  hoursConfigured: boolean;
  version: number | null;
  timezone: string;
  days: unknown[];
  isOpenNow?: boolean;
  currentClosesAt?: string | null;
  nextOpenAt?: string | null;
};

const INSIDE: [number, number] = [36.75, 3.05];
const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

function weeklyDays(
  intervalsByDay: Partial<
    Record<number, Array<{ opens: string; closes: string }>>
  > = {},
) {
  return ISO_DAYS_OF_WEEK.map((dayOfWeek) => ({
    dayOfWeek,
    intervals: intervalsByDay[dayOfWeek] ?? [],
  }));
}

describe('Merchant opening hours (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let fixedNow: Date | null = null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CHECKOUT_CLOCK)
      .useValue({
        now: () => fixedNow ?? new Date(),
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sender = app.get(OTP_SENDER);
    prisma = app.get(PrismaService);
    await deactivateAllDeliveryZones(prisma);
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
        deviceName: 'opening-hours-e2e',
      });
    expect(verified.status).toBe(200);
    return (verified.body as TokenBody).accessToken;
  }

  async function authMe(token: string): Promise<AuthMeBody['account']> {
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    return (me.body as AuthMeBody).account;
  }

  async function approveMerchant(merchantId: string): Promise<void> {
    await prisma
      .getDb()
      .orm.public.Merchant.where({ id: merchantId })
      .update({
        status: pgVarchar<64>('ACTIVE'),
        verifiedAt: pgNow(),
        updatedAt: pgNow(),
      });
  }

  async function cleanupAccount(phoneE164: string): Promise<void> {
    const account = await prisma
      .getDb()
      .orm.public.Account.where({ phone: phoneE164 })
      .first();
    if (!account) {
      return;
    }
    const members = await prisma
      .getDb()
      .orm.public.MerchantMember.where({ accountId: account.id })
      .all();
    for (const member of members) {
      const branches = await prisma
        .getDb()
        .orm.public.MerchantBranch.where({ merchantId: member.merchantId })
        .all();
      for (const branch of branches) {
        const schedule = await prisma
          .getDb()
          .orm.public.MerchantBranchOpeningSchedule.where({
            branchId: branch.id,
          })
          .first();
        if (schedule) {
          await prisma
            .getDb()
            .orm.public.MerchantBranchOpeningInterval.where({
              scheduleId: schedule.id,
            })
            .delete();
          await prisma
            .getDb()
            .orm.public.MerchantBranchOpeningSchedule.where({
              id: schedule.id,
            })
            .delete();
        }
        const branchCarts = await prisma
          .getDb()
          .orm.public.Cart.where({ merchantBranchId: branch.id })
          .all();
        for (const cart of branchCarts) {
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
        await deleteBranchOpeningHours(prisma, branch.id);
        await prisma
          .getDb()
          .orm.public.MerchantBranch.where({ id: branch.id })
          .delete();
      }
      await prisma
        .getDb()
        .orm.public.MerchantMember.where({ id: member.id })
        .delete();
      await prisma
        .getDb()
        .orm.public.Merchant.where({ id: member.merchantId })
        .delete();
    }
    const profile = await prisma
      .getDb()
      .orm.public.CustomerProfile.where({ accountId: account.id })
      .first();
    if (profile) {
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

  async function countOrders(): Promise<number> {
    return (await prisma.getDb().orm.public.Order.all()).length;
  }

  async function countPayments(): Promise<number> {
    return (await prisma.getDb().orm.public.Payment.all()).length;
  }

  async function countCodCollections(): Promise<number> {
    return (await prisma.getDb().orm.public.CodCollection.all()).length;
  }

  async function countDeliveries(): Promise<number> {
    return (await prisma.getDb().orm.public.Delivery.all()).length;
  }

  async function createZoneWithPricing(label: string): Promise<string> {
    const id = createUuidV7();
    const now = pgNow();
    await prisma.getDb().orm.public.DeliveryZone.create({
      id,
      name: pgVarchar<255>(label),
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[COVERING_RING]],
        srid: 4326,
      },
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await prisma.getDb().orm.public.DeliveryPricingRule.create({
      id: createUuidV7(),
      zoneId: id,
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
    return id;
  }

  async function deleteZone(zoneId: string): Promise<void> {
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
    await prisma.getDb().orm.public.DeliveryZone.where({ id: zoneId }).delete();
  }

  function assertSafeCustomerHoursProjection(body: Record<string, unknown>) {
    expect(body).toHaveProperty('hoursConfigured');
    expect(body).toHaveProperty('isOpenNow');
    expect(body).toHaveProperty('timezone');
    expect(body).toHaveProperty('currentClosesAt');
    expect(body).toHaveProperty('nextOpenAt');
    expect(body.timezone).toBe('Africa/Algiers');
    expect(body).not.toHaveProperty('version');
    expect(body).not.toHaveProperty('updatedByAccountId');
    expect(body).not.toHaveProperty('updatedAt');
    expect(body).not.toHaveProperty('scheduleId');
    expect(body).not.toHaveProperty('verifiedAt');
    expect(body).not.toHaveProperty('membership');
    expect(body).not.toHaveProperty('members');
    if (typeof body.currentClosesAt === 'string') {
      expect(body.currentClosesAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    }
    if (typeof body.nextOpenAt === 'string') {
      expect(body.nextOpenAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    }
  }

  it('covers merchant GET/PUT, version conflict, foreign deny, catalog, checkout boundaries, concurrency', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0571${suffix}`,
      owner: `0572${suffix}`,
      foreign: `0573${suffix}`,
    };
    const e164: string[] = [];
    let zoneId: string | null = null;
    fixedNow = new Date('2024-01-15T10:00:00.000Z'); // Mon 11:00 Africa/Algiers

    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenOwner = await authenticate(phones.owner);
      const tokenForeign = await authenticate(phones.foreign);
      const accountOwner = await authMe(tokenOwner);
      e164.push(
        (await authMe(tokenCustomer)).phone,
        accountOwner.phone,
        (await authMe(tokenForeign)).phone,
      );

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'Hours Customer' });

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Hours Cafe' });
      expect(merchant.status).toBe(201);
      const merchantId = (merchant.body as MembershipBody).merchantId;

      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'Main',
          phone: '0550123400',
          addressText: 'Street',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      expect(branch.status).toBe(201);
      const branchId = (branch.body as BranchBody).id;
      await approveMerchant(merchantId);

      const emptyGet = await request(server)
        .get(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/opening-hours`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(emptyGet.status).toBe(200);
      const emptyBody = emptyGet.body as OpeningHoursBody;
      expect(emptyBody.hoursConfigured).toBe(false);
      expect(emptyBody.version).toBeNull();
      expect(emptyBody.timezone).toBe('Africa/Algiers');
      expect(emptyBody.days).toHaveLength(7);

      const foreignGet = await request(server)
        .get(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/opening-hours`,
        )
        .set('Authorization', `Bearer ${tokenForeign}`);
      expect(foreignGet.status).toBe(404);
      expect((foreignGet.body as ErrorBody).error.code).toBe(
        'MERCHANT_NOT_FOUND',
      );

      const putBody = {
        expectedVersion: 0,
        days: weeklyDays({
          1: [{ opens: '09:00', closes: '17:00' }],
        }),
      };
      const created = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/opening-hours`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send(putBody);
      expect(created.status).toBe(200);
      const createdBody = created.body as OpeningHoursBody;
      expect(createdBody.hoursConfigured).toBe(true);
      expect(createdBody.version).toBe(1);
      expect(
        (
          createdBody.days[0] as {
            intervals: Array<{ closesNextDay: boolean }>;
          }
        ).intervals[0].closesNextDay,
      ).toBe(false);

      const conflict = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/opening-hours`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send(putBody);
      expect(conflict.status).toBe(409);
      expect((conflict.body as ErrorBody).error.code).toBe(
        'OPENING_HOURS_VERSION_CONFLICT',
      );

      const foreignPut = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/opening-hours`,
        )
        .set('Authorization', `Bearer ${tokenForeign}`)
        .send({
          expectedVersion: 1,
          days: weeklyDays({ 1: [{ opens: '10:00', closes: '18:00' }] }),
        });
      expect(foreignPut.status).toBe(404);
      expect((foreignPut.body as ErrorBody).error.code).toBe(
        'MERCHANT_NOT_FOUND',
      );

      const storefront = await request(server)
        .get(`/api/v1/customer/branches/${branchId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(storefront.status).toBe(200);
      const storefrontBody = storefront.body as OpeningHoursBody & {
        days: Array<{ intervals: Array<Record<string, unknown>> }>;
      };
      expect(storefrontBody.hoursConfigured).toBe(true);
      expect(storefrontBody.isOpenNow).toBe(true);
      expect(storefrontBody.timezone).toBe('Africa/Algiers');
      expect(storefrontBody.currentClosesAt).toBe('2024-01-15T16:00:00.000Z');
      expect(storefrontBody.nextOpenAt).toBeNull();
      expect(storefrontBody.days).toHaveLength(7);
      expect(storefrontBody.days[0].intervals[0]).not.toHaveProperty('id');

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
          name: 'Coffee',
          priceMinor: 1000,
        });
      const productId = (product.body as ProductBody).id;

      const address = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          label: 'Home',
          addressText: 'Inside',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const addressId = (address.body as AddressBody).id;

      zoneId = createUuidV7();
      const now = pgNow();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Hours zone ${suffix}`),
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[COVERING_RING]],
          srid: 4326,
        },
        active: true,
        createdAt: now,
        updatedAt: now,
      });
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

      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ productId, quantity: 1 });

      const openPreview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ addressId });
      expect(openPreview.status).toBe(200);

      // Exact close = closed (17:00 Algiers = 16:00 UTC)
      fixedNow = new Date('2024-01-15T16:00:00.000Z');
      const closedAtClose = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ addressId });
      expect(closedAtClose.status).toBe(409);
      expect((closedAtClose.body as ErrorBody).error.code).toBe(
        'CHECKOUT_BRANCH_CLOSED',
      );

      // Exact open = open
      fixedNow = new Date('2024-01-15T08:00:00.000Z');
      const openAtOpen = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ addressId });
      expect(openAtOpen.status).toBe(200);

      // Concurrency: two PUTs with same expectedVersion
      fixedNow = new Date('2024-01-15T10:00:00.000Z');
      const concurrentBody = {
        expectedVersion: 1,
        days: weeklyDays({
          1: [{ opens: '08:00', closes: '16:00' }],
        }),
      };
      const [first, second] = await Promise.all([
        request(server)
          .put(
            `/api/v1/merchant/${merchantId}/branches/${branchId}/opening-hours`,
          )
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send(concurrentBody),
        request(server)
          .put(
            `/api/v1/merchant/${merchantId}/branches/${branchId}/opening-hours`,
          )
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send(concurrentBody),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
      const winner = first.status === 200 ? first : second;
      expect((winner.body as OpeningHoursBody).version).toBe(2);
    } finally {
      fixedNow = null;
      if (zoneId) {
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
      for (const phone of e164) {
        await cleanupAccount(phone);
      }
    }
  });

  it('rejects checkout preview and final Order when Branch has no opening schedule', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0574${suffix}`,
      owner: `0575${suffix}`,
    };
    const e164: string[] = [];
    let zoneId: string | null = null;
    fixedNow = new Date('2024-01-15T10:00:00.000Z');

    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenOwner = await authenticate(phones.owner);
      e164.push(
        (await authMe(tokenCustomer)).phone,
        (await authMe(tokenOwner)).phone,
      );

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'No Hours Customer' });

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'No Hours Cafe' });
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'Main',
          phone: '0550123401',
          addressText: 'Street',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const branchId = (branch.body as BranchBody).id;
      await approveMerchant(merchantId);

      const emptyHours = await request(server)
        .get(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/opening-hours`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(emptyHours.status).toBe(200);
      expect((emptyHours.body as OpeningHoursBody).hoursConfigured).toBe(false);

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

      const address = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          label: 'Home',
          addressText: 'Inside',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const addressId = (address.body as AddressBody).id;
      zoneId = await createZoneWithPricing(`No-hours zone ${suffix}`);

      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ productId, quantity: 1 });

      const cartBefore = await request(server)
        .get('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(cartBefore.status).toBe(200);
      const cartBeforeBody = cartBefore.body as {
        cartExists: boolean;
        cart: { items: unknown[]; itemCount: number } | null;
      };
      expect(cartBeforeBody.cartExists).toBe(true);
      expect(cartBeforeBody.cart?.itemCount).toBeGreaterThan(0);

      const ordersBefore = await countOrders();
      const paymentsBefore = await countPayments();
      const codBefore = await countCodCollections();
      const deliveriesBefore = await countDeliveries();

      const preview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ addressId });
      expect(preview.status).toBe(409);
      expect((preview.body as ErrorBody).error.code).toBe(
        'CHECKOUT_BRANCH_HOURS_NOT_CONFIGURED',
      );

      const created = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          addressId,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: 1000,
          expectedDeliveryFeeMinor: 500,
          expectedCustomerTotalMinor: 1500,
        });
      expect(created.status).toBe(409);
      expect((created.body as ErrorBody).error.code).toBe(
        'ORDER_BRANCH_HOURS_NOT_CONFIGURED',
      );

      expect(await countOrders()).toBe(ordersBefore);
      expect(await countPayments()).toBe(paymentsBefore);
      expect(await countCodCollections()).toBe(codBefore);
      expect(await countDeliveries()).toBe(deliveriesBefore);

      const cartAfter = await request(server)
        .get('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(cartAfter.status).toBe(200);
      const cartAfterBody = cartAfter.body as {
        cartExists: boolean;
        cart: { itemCount: number } | null;
      };
      expect(cartAfterBody.cartExists).toBe(true);
      expect(cartAfterBody.cart?.itemCount).toBe(
        cartBeforeBody.cart?.itemCount,
      );
    } finally {
      fixedNow = null;
      if (zoneId) {
        await deleteZone(zoneId);
      }
      for (const phone of e164) {
        await cleanupAccount(phone);
      }
    }
  });

  it('rejects final Order with ORDER_BRANCH_CLOSED after preview succeeded while open', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0576${suffix}`,
      owner: `0577${suffix}`,
    };
    const e164: string[] = [];
    let zoneId: string | null = null;
    // Mon 11:00 Africa/Algiers
    fixedNow = new Date('2024-01-15T10:00:00.000Z');

    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenOwner = await authenticate(phones.owner);
      e164.push(
        (await authMe(tokenCustomer)).phone,
        (await authMe(tokenOwner)).phone,
      );

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'Recheck Customer' });

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Recheck Cafe' });
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'Main',
          phone: '0550123402',
          addressText: 'Street',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const branchId = (branch.body as BranchBody).id;
      await approveMerchant(merchantId);

      const openPut = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/opening-hours`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          expectedVersion: 0,
          days: weeklyDays({
            1: [{ opens: '09:00', closes: '17:00' }],
          }),
        });
      expect(openPut.status).toBe(200);
      expect((openPut.body as OpeningHoursBody).version).toBe(1);

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
          name: 'Latte',
          priceMinor: 1000,
        });
      const productId = (product.body as ProductBody).id;

      const address = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          label: 'Home',
          addressText: 'Inside',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const addressId = (address.body as AddressBody).id;
      zoneId = await createZoneWithPricing(`Recheck zone ${suffix}`);

      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ productId, quantity: 1 });

      const preview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ addressId });
      expect(preview.status).toBe(200);
      const previewBody = preview.body as {
        merchandiseSubtotalMinor: string;
        deliveryFeeMinor: string;
        customerTotalMinor: string;
      };

      // Close at the same clock instant via real Merchant PUT (version bump).
      const closePut = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/opening-hours`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          expectedVersion: 1,
          days: weeklyDays({
            1: [{ opens: '12:00', closes: '17:00' }],
          }),
        });
      expect(closePut.status).toBe(200);
      expect((closePut.body as OpeningHoursBody).version).toBe(2);

      const ordersBefore = await countOrders();
      const paymentsBefore = await countPayments();
      const codBefore = await countCodCollections();
      const deliveriesBefore = await countDeliveries();

      const cartBefore = await request(server)
        .get('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      const cartBeforeBody = cartBefore.body as {
        cartExists: boolean;
        cart: { itemCount: number } | null;
      };
      expect(cartBeforeBody.cartExists).toBe(true);
      expect(cartBeforeBody.cart?.itemCount).toBeGreaterThan(0);

      const created = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          addressId,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: Number(
            previewBody.merchandiseSubtotalMinor,
          ),
          expectedDeliveryFeeMinor: Number(previewBody.deliveryFeeMinor),
          expectedCustomerTotalMinor: Number(previewBody.customerTotalMinor),
        });
      expect(created.status).toBe(409);
      expect((created.body as ErrorBody).error.code).toBe(
        'ORDER_BRANCH_CLOSED',
      );

      expect(await countOrders()).toBe(ordersBefore);
      expect(await countPayments()).toBe(paymentsBefore);
      expect(await countCodCollections()).toBe(codBefore);
      expect(await countDeliveries()).toBe(deliveriesBefore);

      const cartAfter = await request(server)
        .get('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      const cartAfterBody = cartAfter.body as {
        cartExists: boolean;
        cart: { itemCount: number } | null;
      };
      expect(cartAfterBody.cartExists).toBe(true);
      expect(cartAfterBody.cart?.itemCount).toBe(
        cartBeforeBody.cart?.itemCount,
      );
    } finally {
      fixedNow = null;
      if (zoneId) {
        await deleteZone(zoneId);
      }
      for (const phone of e164) {
        await cleanupAccount(phone);
      }
    }
  });

  it('exposes safe opening-hours projection on customer list/detail/search and keeps unconfigured Branches browseable', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0578${suffix}`,
      owner: `0579${suffix}`,
    };
    const e164: string[] = [];
    // Mon 11:00 Africa/Algiers — inside 09:00–17:00 when configured
    fixedNow = new Date('2024-01-15T10:00:00.000Z');
    const uniqueName = `HoursProj${suffix}`;

    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenOwner = await authenticate(phones.owner);
      e164.push(
        (await authMe(tokenCustomer)).phone,
        (await authMe(tokenOwner)).phone,
      );

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'Projection Customer' });

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: uniqueName });
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: `${uniqueName} Branch`,
          phone: '0550123403',
          addressText: 'Street',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const branchId = (branch.body as BranchBody).id;
      await approveMerchant(merchantId);

      const category = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ branchId, name: 'Drinks' });
      await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          branchId,
          categoryId: (category.body as CategoryBody).id,
          name: `${uniqueName} Coffee`,
          priceMinor: 1000,
        });

      const listUnconfigured = await request(server)
        .get('/api/v1/customer/branches?limit=50&offset=0')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(listUnconfigured.status).toBe(200);
      const listItems = (
        listUnconfigured.body as { items: Array<Record<string, unknown>> }
      ).items;
      const unconfiguredSummary = listItems.find(
        (item) => item.branchId === branchId,
      );
      expect(unconfiguredSummary).toBeDefined();
      assertSafeCustomerHoursProjection(unconfiguredSummary!);
      expect(unconfiguredSummary!.hoursConfigured).toBe(false);
      expect(unconfiguredSummary!.isOpenNow).toBe(false);
      expect(unconfiguredSummary!.currentClosesAt).toBeNull();
      expect(unconfiguredSummary!.nextOpenAt).toBeNull();

      const detailUnconfigured = await request(server)
        .get(`/api/v1/customer/branches/${branchId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(detailUnconfigured.status).toBe(200);
      const detailEmpty = detailUnconfigured.body as Record<string, unknown> & {
        days: Array<{ dayOfWeek: number; intervals: unknown[] }>;
      };
      assertSafeCustomerHoursProjection(detailEmpty);
      expect(detailEmpty.hoursConfigured).toBe(false);
      expect(detailEmpty.isOpenNow).toBe(false);
      expect(detailEmpty.currentClosesAt).toBeNull();
      expect(detailEmpty.nextOpenAt).toBeNull();
      expect(detailEmpty.days).toHaveLength(7);
      for (const day of detailEmpty.days) {
        expect(day.intervals).toEqual([]);
        for (const interval of day.intervals) {
          expect(interval).not.toHaveProperty('id');
        }
      }

      const searchUnconfigured = await request(server)
        .get(
          `/api/v1/customer/catalog/search?q=${encodeURIComponent(uniqueName)}`,
        )
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchUnconfigured.status).toBe(200);
      const searchHits = (
        searchUnconfigured.body as {
          items: Array<{ storefront: Record<string, unknown> }>;
        }
      ).items;
      const unconfiguredHit = searchHits.find(
        (hit) => hit.storefront.branchId === branchId,
      );
      expect(unconfiguredHit).toBeDefined();
      assertSafeCustomerHoursProjection(unconfiguredHit!.storefront);
      expect(unconfiguredHit!.storefront.hoursConfigured).toBe(false);
      expect(unconfiguredHit!.storefront.isOpenNow).toBe(false);

      const put = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/opening-hours`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          expectedVersion: 0,
          days: weeklyDays({
            1: [{ opens: '09:00', closes: '17:00' }],
          }),
        });
      expect(put.status).toBe(200);
      expect((put.body as OpeningHoursBody).version).toBe(1);

      const listConfigured = await request(server)
        .get('/api/v1/customer/branches?limit=50&offset=0')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      const configuredSummary = (
        listConfigured.body as { items: Array<Record<string, unknown>> }
      ).items.find((item) => item.branchId === branchId)!;
      assertSafeCustomerHoursProjection(configuredSummary);
      expect(configuredSummary.hoursConfigured).toBe(true);
      expect(configuredSummary.isOpenNow).toBe(true);
      expect(configuredSummary.currentClosesAt).toBe(
        '2024-01-15T16:00:00.000Z',
      );
      expect(configuredSummary.nextOpenAt).toBeNull();

      const detailConfigured = await request(server)
        .get(`/api/v1/customer/branches/${branchId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(detailConfigured.status).toBe(200);
      const detail = detailConfigured.body as Record<string, unknown> & {
        days: Array<{
          dayOfWeek: number;
          intervals: Array<Record<string, unknown>>;
        }>;
      };
      assertSafeCustomerHoursProjection(detail);
      expect(detail.hoursConfigured).toBe(true);
      expect(detail.isOpenNow).toBe(true);
      expect(detail.currentClosesAt).toBe('2024-01-15T16:00:00.000Z');
      expect(detail.nextOpenAt).toBeNull();
      expect(detail.days).toHaveLength(7);
      expect(detail.days.map((d) => d.dayOfWeek)).toEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
      expect(detail.days[0].intervals[0]).toMatchObject({
        opens: '09:00',
        closes: '17:00',
        opensMinute: 540,
        closesMinute: 1020,
        closesNextDay: false,
      });
      expect(detail.days[0].intervals[0]).not.toHaveProperty('id');
      expect(detail).not.toHaveProperty('version');
      expect(detail).not.toHaveProperty('updatedByAccountId');

      const searchConfigured = await request(server)
        .get(
          `/api/v1/customer/catalog/search?q=${encodeURIComponent(uniqueName)}`,
        )
        .set('Authorization', `Bearer ${tokenCustomer}`);
      const configuredHit = (
        searchConfigured.body as {
          items: Array<{ storefront: Record<string, unknown> }>;
        }
      ).items.find((hit) => hit.storefront.branchId === branchId)!;
      assertSafeCustomerHoursProjection(configuredHit.storefront);
      expect(configuredHit.storefront.hoursConfigured).toBe(true);
      expect(configuredHit.storefront.isOpenNow).toBe(true);
      expect(configuredHit.storefront.currentClosesAt).toBe(
        '2024-01-15T16:00:00.000Z',
      );
      expect(configuredHit.storefront.nextOpenAt).toBeNull();
      expect(configuredHit.storefront).not.toHaveProperty('days');
      expect(configuredHit.storefront).not.toHaveProperty('version');
    } finally {
      fixedNow = null;
      for (const phone of e164) {
        await cleanupAccount(phone);
      }
    }
  });
});
