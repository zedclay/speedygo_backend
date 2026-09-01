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
  pgNumeric,
  pgTime,
  pgTimestamptz,
  pgVarchar,
} from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type AuthMeBody = { account: { id: string; phone: string } };
type MembershipBody = { merchantId: string };
type BranchBody = { id: string };
type CategoryBody = { id: string };
type ProductBody = { id: string };
type OptionGroupBody = { id: string };
type OptionBody = { id: string };
type AddressBody = { id: string };
type CartBody = {
  id: string;
  cartReady: boolean;
  cartSubtotalMinor: number;
  items: Array<{ id: string; unitPriceMinor: number }>;
};
type PreviewBody = {
  checkoutReady: true;
  warnings: string[];
  merchandiseSubtotalMinor: number;
  deliveryFeeMinor: number;
  customerTotalMinor: number;
  deliveryZone: { id: string; name: string };
  pricing: { ruleId: string; timeBand: string; timezone: string };
};

const INSIDE: [number, number] = [36.75, 3.05];
const BOUNDARY: [number, number] = [36.75, 3.0];
const OUTSIDE: [number, number] = [36.75, 4.0];

const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

const OVERLAP_RING: Array<[number, number]> = [
  [3.04, 36.74],
  [3.06, 36.74],
  [3.06, 36.76],
  [3.04, 36.76],
  [3.04, 36.74],
];

describe('Checkout foundation (e2e)', () => {
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
        platform: 'android',
        appVersion: '1.0.0',
        deviceName: 'checkout-e2e',
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

  async function approveMerchant(merchantId: string): Promise<void> {
    const now = pgNow();
    await prisma
      .getDb()
      .orm.public.Merchant.where({ id: merchantId })
      .update({
        status: pgVarchar<64>('ACTIVE'),
        verifiedAt: now,
        updatedAt: now,
      });
  }

  async function cleanupZones(zoneIds: string[]): Promise<void> {
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
      const remainingMembers = await prisma
        .getDb()
        .orm.public.MerchantMember.where({ merchantId })
        .all();
      for (const member of remainingMembers) {
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

  it('previews Checkout without creating an Order and exercises PostGIS plus catalog blockers', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      a: `0581${suffix}`,
      b: `0582${suffix}`,
      merchant: `0583${suffix}`,
    };
    const e164: string[] = [];
    const zoneIds: string[] = [];
    try {
      const tokenA = await authenticate(phones.a);
      const tokenB = await authenticate(phones.b);
      const tokenMerchant = await authenticate(phones.merchant);
      e164.push(
        (await authMe(tokenA)).phone,
        (await authMe(tokenB)).phone,
        (await authMe(tokenMerchant)).phone,
      );

      const noProfile = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: createUuidV7() });
      expect(noProfile.status).toBe(404);
      expect((noProfile.body as ErrorBody).error.code).toBe(
        'CUSTOMER_PROFILE_NOT_FOUND',
      );

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: 'Checkout Customer A' });
      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ fullName: 'Checkout Customer B' });

      const noCart = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: createUuidV7() });
      expect(noCart.status).toBe(409);
      expect((noCart.body as ErrorBody).error.code).toBe(
        'CHECKOUT_CART_REQUIRED',
      );

      const home = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          label: 'Home',
          addressText: 'Inside zone',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      expect(home.status).toBe(201);
      const homeId = (home.body as AddressBody).id;

      const boundary = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          label: 'Boundary',
          addressText: 'On polygon edge',
          latitude: BOUNDARY[0],
          longitude: BOUNDARY[1],
        });
      expect(boundary.status).toBe(201);
      const boundaryId = (boundary.body as AddressBody).id;

      const outside = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          label: 'Outside',
          addressText: 'Outside zone',
          latitude: OUTSIDE[0],
          longitude: OUTSIDE[1],
        });
      expect(outside.status).toBe(201);
      const outsideId = (outside.body as AddressBody).id;

      const foreign = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          label: 'B Home',
          addressText: 'Foreign',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      expect(foreign.status).toBe(201);
      const foreignId = (foreign.body as AddressBody).id;

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ name: 'Checkout Cafe' });
      expect(merchant.status).toBe(201);
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'Main',
          phone: '0550123499',
          addressText: 'Street A',
          latitude: 36.75,
          longitude: 3.05,
        });
      expect(branch.status).toBe(201);
      const branchId = (branch.body as BranchBody).id;
      await approveMerchant(merchantId);

      const category = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ branchId, name: 'Drinks' });
      expect(category.status).toBe(201);
      const categoryId = (category.body as CategoryBody).id;

      const product = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          branchId,
          categoryId,
          name: 'Coffee',
          priceMinor: 1000,
        });
      expect(product.status).toBe(201);
      const productId = (product.body as ProductBody).id;

      const group = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'Size',
          required: true,
          minSelections: 1,
          maxSelections: 1,
        });
      expect(group.status).toBe(201);
      const groupId = (group.body as OptionGroupBody).id;
      const large = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups/${groupId}/options`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ name: 'Large', additionalPriceMinor: 200 });
      expect(large.status).toBe(201);
      const largeId = (large.body as OptionBody).id;

      const added = await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId, quantity: 1, optionIds: [largeId] });
      expect(added.status).toBe(200);
      expect((added.body as CartBody).cartReady).toBe(true);
      expect((added.body as CartBody).cartSubtotalMinor).toBe(1200);

      const now = pgNow();
      const zoneId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Checkout zone ${suffix}`),
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

      const ruleId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryPricingRule.create({
        id: ruleId,
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

      const preview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(preview.status).toBe(200);
      const ready = preview.body as PreviewBody;
      expect(ready.checkoutReady).toBe(true);
      expect(ready.warnings).toEqual([]);
      expect(ready.merchandiseSubtotalMinor).toBe(1200);
      expect(ready.deliveryFeeMinor).toBe(500);
      expect(ready.customerTotalMinor).toBe(1700);
      expect(ready.deliveryZone.id).toBe(zoneId);
      expect(ready.pricing.ruleId).toBe(ruleId);
      expect(ready.pricing.timezone).toBe('Africa/Algiers');

      await prisma
        .getDb()
        .orm.public.DeliveryPricingRule.where({ id: ruleId })
        .update({
          customerDeliveryFeeMinor: pgBigInt(800),
          updatedAt: pgNow(),
        });
      const liveFee = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(liveFee.status).toBe(200);
      expect((liveFee.body as PreviewBody).deliveryFeeMinor).toBe(800);
      expect((liveFee.body as PreviewBody).customerTotalMinor).toBe(2000);

      await prisma
        .getDb()
        .orm.public.DeliveryPricingRule.where({ id: ruleId })
        .update({
          customerDeliveryFeeMinor: pgBigInt(500),
          startLocalTime: pgTime('00:00:00'),
          endLocalTime: pgTime('23:59:59'),
          updatedAt: pgNow(),
        });
      const windowed = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(windowed.status).toBe(200);
      expect((windowed.body as PreviewBody).deliveryFeeMinor).toBe(500);

      const malformed = createUuidV7();
      await prisma.getDb().orm.public.DeliveryPricingRule.create({
        id: malformed,
        zoneId,
        name: pgVarchar<255>('One sided'),
        timeBand: 'CUSTOM',
        startLocalTime: pgTime('08:00:00'),
        endLocalTime: null,
        customerDeliveryFeeMinor: pgBigInt(1),
        driverRemunerationMinor: pgBigInt(1),
        effectiveFrom: pgTimestamptz('2020-01-01T00:00:00.000Z'),
        effectiveTo: null,
        active: true,
        createdAt: pgNow(),
        updatedAt: pgNow(),
      });
      const malformedPreview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(malformedPreview.status).toBe(409);
      expect((malformedPreview.body as ErrorBody).error.code).toBe(
        'CHECKOUT_PRICING_CONFIGURATION_INVALID',
      );
      await prisma
        .getDb()
        .orm.public.DeliveryPricingRule.where({ id: malformed })
        .delete();

      const priced = await request(server)
        .patch(`/api/v1/merchant/${merchantId}/products/${productId}`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ priceMinor: 1300 });
      expect(priced.status).toBe(200);

      const changed = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(changed.status).toBe(200);
      const changedBody = changed.body as PreviewBody;
      expect(changedBody.checkoutReady).toBe(true);
      expect(changedBody.warnings).toEqual(['PRICE_CHANGED']);
      expect(changedBody.merchandiseSubtotalMinor).toBe(1500);
      expect(changedBody.deliveryFeeMinor).toBe(500);
      expect(changedBody.customerTotalMinor).toBe(2000);

      const stolen = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: foreignId });
      expect(stolen.status).toBe(404);
      expect((stolen.body as ErrorBody).error.code).toBe(
        'CHECKOUT_ADDRESS_NOT_FOUND',
      );

      await prisma
        .getDb()
        .orm.public.Address.where({ id: homeId })
        .update({
          latitude: pgNumeric<9, 6>(91, 6),
          updatedAt: pgNow(),
        });
      const badCoords = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(badCoords.status).toBe(400);
      expect((badCoords.body as ErrorBody).error.code).toBe(
        'CHECKOUT_ADDRESS_COORDINATES_REQUIRED',
      );
      await prisma
        .getDb()
        .orm.public.Address.where({ id: homeId })
        .update({
          latitude: pgNumeric<9, 6>(INSIDE[0], 6),
          longitude: pgNumeric<9, 6>(INSIDE[1], 6),
          updatedAt: pgNow(),
        });

      const out = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: outsideId });
      expect(out.status).toBe(409);
      expect((out.body as ErrorBody).error.code).toBe(
        'CHECKOUT_ADDRESS_OUTSIDE_ZONE',
      );

      const onBoundary = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: boundaryId });
      expect(onBoundary.status).toBe(200);
      expect((onBoundary.body as PreviewBody).checkoutReady).toBe(true);

      const overlapId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: overlapId,
        name: pgVarchar<255>(`Overlap ${suffix}`),
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[OVERLAP_RING]],
          srid: 4326,
        },
        active: true,
        createdAt: pgNow(),
        updatedAt: pgNow(),
      });
      zoneIds.push(overlapId);
      const ambiguous = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(ambiguous.status).toBe(409);
      expect((ambiguous.body as ErrorBody).error.code).toBe(
        'CHECKOUT_DELIVERY_ZONE_AMBIGUOUS',
      );
      await prisma
        .getDb()
        .orm.public.DeliveryZone.where({ id: overlapId })
        .delete();
      zoneIds.splice(zoneIds.indexOf(overlapId), 1);

      const extraRule = createUuidV7();
      await prisma.getDb().orm.public.DeliveryPricingRule.create({
        id: extraRule,
        zoneId,
        name: pgVarchar<255>('Overlap fee'),
        timeBand: 'CUSTOM',
        startLocalTime: pgTime('00:00:00'),
        endLocalTime: pgTime('23:59:59'),
        customerDeliveryFeeMinor: pgBigInt(700),
        driverRemunerationMinor: pgBigInt(300),
        effectiveFrom: pgTimestamptz('2020-01-01T00:00:00.000Z'),
        effectiveTo: null,
        active: true,
        createdAt: pgNow(),
        updatedAt: pgNow(),
      });
      const overlapFee = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(overlapFee.status).toBe(409);
      expect((overlapFee.body as ErrorBody).error.code).toBe(
        'CHECKOUT_PRICING_CONFIGURATION_INVALID',
      );
      await prisma
        .getDb()
        .orm.public.DeliveryPricingRule.where({ id: extraRule })
        .delete();

      const expired = createUuidV7();
      const future = createUuidV7();
      await prisma.getDb().orm.public.DeliveryPricingRule.create({
        id: expired,
        zoneId,
        name: pgVarchar<255>('Expired'),
        timeBand: 'DAY',
        startLocalTime: pgTime('00:00:00'),
        endLocalTime: pgTime('23:59:59'),
        customerDeliveryFeeMinor: pgBigInt(1),
        driverRemunerationMinor: pgBigInt(1),
        effectiveFrom: pgTimestamptz('2019-01-01T00:00:00.000Z'),
        effectiveTo: pgTimestamptz('2020-01-01T00:00:00.000Z'),
        active: true,
        createdAt: pgNow(),
        updatedAt: pgNow(),
      });
      await prisma.getDb().orm.public.DeliveryPricingRule.create({
        id: future,
        zoneId,
        name: pgVarchar<255>('Future'),
        timeBand: 'DAY',
        startLocalTime: pgTime('00:00:00'),
        endLocalTime: pgTime('23:59:59'),
        customerDeliveryFeeMinor: pgBigInt(2),
        driverRemunerationMinor: pgBigInt(1),
        effectiveFrom: pgTimestamptz('2099-01-01T00:00:00.000Z'),
        effectiveTo: null,
        active: true,
        createdAt: pgNow(),
        updatedAt: pgNow(),
      });
      const stillReady = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(stillReady.status).toBe(200);
      expect((stillReady.body as PreviewBody).pricing.ruleId).toBe(ruleId);
      await prisma
        .getDb()
        .orm.public.DeliveryPricingRule.where({ id: expired })
        .delete();
      await prisma
        .getDb()
        .orm.public.DeliveryPricingRule.where({ id: future })
        .delete();

      await request(server)
        .patch(`/api/v1/merchant/${merchantId}/products/${productId}`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ available: false });
      const unavailable = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(unavailable.status).toBe(409);
      expect((unavailable.body as ErrorBody).error.code).toBe(
        'CHECKOUT_CART_NOT_READY',
      );
      await request(server)
        .patch(`/api/v1/merchant/${merchantId}/products/${productId}`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ available: true });

      await request(server)
        .patch(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups/${groupId}/options/${largeId}`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ available: false });
      const optionGone = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(optionGone.status).toBe(409);
      expect((optionGone.body as ErrorBody).error.code).toBe(
        'CHECKOUT_CART_NOT_READY',
      );
      await request(server)
        .patch(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups/${groupId}/options/${largeId}`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ available: true });

      await request(server)
        .patch(`/api/v1/merchant/${merchantId}/categories/${categoryId}`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ active: false });
      const categoryOff = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(categoryOff.status).toBe(409);
      expect((categoryOff.body as ErrorBody).error.code).toBe(
        'CHECKOUT_CART_NOT_READY',
      );
      await request(server)
        .patch(`/api/v1/merchant/${merchantId}/categories/${categoryId}`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ active: true });

      await prisma
        .getDb()
        .orm.public.MerchantBranch.where({ id: branchId })
        .update({
          operationalStatus: pgVarchar<64>('INACTIVE'),
          updatedAt: pgNow(),
        });
      const branchOff = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(branchOff.status).toBe(409);
      expect((branchOff.body as ErrorBody).error.code).toBe(
        'CHECKOUT_BRANCH_NOT_OPERATIONAL',
      );
      await prisma
        .getDb()
        .orm.public.MerchantBranch.where({ id: branchId })
        .update({
          operationalStatus: pgVarchar<64>('ACTIVE'),
          updatedAt: pgNow(),
        });

      await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantId })
        .update({
          status: pgVarchar<64>('SUSPENDED'),
          updatedAt: pgNow(),
        });
      const suspended = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ addressId: homeId });
      expect(suspended.status).toBe(409);
      expect((suspended.body as ErrorBody).error.code).toBe(
        'CHECKOUT_MERCHANT_NOT_OPERATIONAL',
      );

      const injected = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: homeId,
          deliveryFeeMinor: 1,
          pricingRuleId: ruleId,
          cartId: createUuidV7(),
          paymentMethod: 'COD',
          taxMinor: 19,
          tipMinor: 100,
          tipPercentage: 10,
        });
      expect(injected.status).toBe(400);
    } finally {
      await cleanupZones(zoneIds);
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });
});
