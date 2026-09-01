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

type TokenBody = { accessToken: string };
type ErrorBody = {
  error: {
    code: string;
    message: string;
    changes?: string[];
    current?: {
      merchandiseSubtotalMinor: number;
      deliveryFeeMinor: number;
      customerTotalMinor: number;
    };
  };
};
type PreviewBody = {
  merchandiseSubtotalMinor: number;
  deliveryFeeMinor: number;
  customerTotalMinor: number;
};
type AuthMeBody = { account: { id: string; phone: string } };
type MembershipBody = { merchantId: string };
type BranchBody = { id: string };
type CategoryBody = { id: string };
type ProductBody = { id: string };
type OptionGroupBody = { id: string };
type OptionBody = { id: string };
type AddressBody = { id: string };
type OrderDetailBody = {
  id: string;
  publicReference: string;
  status: string;
  fulfillmentStatus: string;
  paymentMethod: string;
  financial: {
    currency: string;
    merchandiseSubtotalMinor: number;
    deliveryFeeMinor: number;
    customerTotalMinor: number;
  };
  items: Array<{
    productNameSnapshot: string;
    unitPriceMinor: number;
    lineTotalMinor: number;
    options: Array<{
      optionNameSnapshot: string;
      additionalPriceMinor: number;
    }>;
  }>;
  deliveryAddress: { addressText: string; instructions: string | null };
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

describe('Order foundation (e2e)', () => {
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
        deviceName: 'order-e2e',
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

  async function previewCheckout(
    token: string,
    addressId: string,
  ): Promise<PreviewBody> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/customer/checkout/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ addressId });
    expect(response.status).toBe(200);
    return response.body as PreviewBody;
  }

  function expectedFrom(preview: PreviewBody) {
    return {
      expectedMerchandiseSubtotalMinor: preview.merchandiseSubtotalMinor,
      expectedDeliveryFeeMinor: preview.deliveryFeeMinor,
      expectedCustomerTotalMinor: preview.customerTotalMinor,
    };
  }

  const PLACEHOLDER_EXPECTED = {
    expectedMerchandiseSubtotalMinor: 0,
    expectedDeliveryFeeMinor: 0,
    expectedCustomerTotalMinor: 0,
  };

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

  async function deleteOrdersForCustomer(customerId: string): Promise<void> {
    const orders = await prisma
      .getDb()
      .orm.public.Order.where({ customerId })
      .all();
    for (const order of orders) {
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
      const events = await prisma
        .getDb()
        .orm.public.OrderStatusEvent.where({ orderId: order.id })
        .all();
      for (const event of events) {
        await prisma
          .getDb()
          .orm.public.OrderStatusEvent.where({ id: event.id })
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

  async function cleanupCommission(adminIds: string[], roleIds: string[]) {
    for (const adminId of adminIds) {
      const rules = await prisma
        .getDb()
        .orm.public.MerchantCommissionRule.where({ changedByAdminId: adminId })
        .all();
      for (const rule of rules) {
        await prisma
          .getDb()
          .orm.public.MerchantCommissionRule.where({ id: rule.id })
          .delete();
      }
      await prisma
        .getDb()
        .orm.public.AdminProfile.where({ id: adminId })
        .delete();
    }
    for (const roleId of roleIds) {
      await prisma.getDb().orm.public.Role.where({ id: roleId }).delete();
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
      await deleteOrdersForCustomer(profile.id);
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

  it('creates a historical Order from a live Cart and refuses duplicates and IDOR', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      a: `0591${suffix}`,
      b: `0592${suffix}`,
      merchant: `0593${suffix}`,
    };
    const e164: string[] = [];
    const zoneIds: string[] = [];
    const adminIds: string[] = [];
    const roleIds: string[] = [];
    try {
      const tokenA = await authenticate(phones.a);
      const tokenB = await authenticate(phones.b);
      const tokenMerchant = await authenticate(phones.merchant);
      const accountA = await authMe(tokenA);
      const accountMerchant = await authMe(tokenMerchant);
      e164.push(
        accountA.phone,
        (await authMe(tokenB)).phone,
        accountMerchant.phone,
      );

      const noProfile = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: createUuidV7(),
          paymentMethod: 'COD',
          ...PLACEHOLDER_EXPECTED,
        });
      expect(noProfile.status).toBe(404);
      expect((noProfile.body as ErrorBody).error.code).toBe(
        'CUSTOMER_PROFILE_NOT_FOUND',
      );

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: 'Order Customer A' });
      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ fullName: 'Order Customer B' });

      const noCart = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: createUuidV7(),
          paymentMethod: 'COD',
          ...PLACEHOLDER_EXPECTED,
        });
      expect(noCart.status).toBe(409);
      expect((noCart.body as ErrorBody).error.code).toBe('ORDER_CART_REQUIRED');

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
        .send({ name: 'Order Cafe' });
      expect(merchant.status).toBe(201);
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'Main',
          phone: '0550123488',
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

      const now = pgNow();
      const zoneId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Order zone ${suffix}`),
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
      const pricingRuleId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryPricingRule.create({
        id: pricingRuleId,
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
        name: pgVarchar<128>(`order-e2e-${suffix}`),
        description: null,
        active: true,
      });
      roleIds.push(roleId);
      const adminId = createUuidV7();
      await prisma.getDb().orm.public.AdminProfile.create({
        id: adminId,
        accountId: accountMerchant.id,
        roleId,
        displayName: pgVarchar<255>('Order E2E Admin'),
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

      const foreignAddr = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: foreignId,
          paymentMethod: 'COD',
          ...PLACEHOLDER_EXPECTED,
        });
      expect(foreignAddr.status).toBe(404);
      expect((foreignAddr.body as ErrorBody).error.code).toBe(
        'ORDER_ADDRESS_NOT_FOUND',
      );

      const outsideOrder = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: outsideId,
          paymentMethod: 'COD',
          ...PLACEHOLDER_EXPECTED,
        });
      expect(outsideOrder.status).toBe(409);
      expect((outsideOrder.body as ErrorBody).error.code).toBe(
        'ORDER_ADDRESS_OUTSIDE_ZONE',
      );

      const preview = await previewCheckout(tokenA, homeId);
      expect(preview.merchandiseSubtotalMinor).toBe(1200);
      expect(preview.deliveryFeeMinor).toBe(500);
      expect(preview.customerTotalMinor).toBe(1700);
      const matching = expectedFrom(preview);

      const fakeLower = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: homeId,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: 1,
          expectedDeliveryFeeMinor: 1,
          expectedCustomerTotalMinor: 2,
        });
      expect(fakeLower.status).toBe(409);
      expect((fakeLower.body as ErrorBody).error.code).toBe(
        'ORDER_RECONFIRMATION_REQUIRED',
      );
      expect((fakeLower.body as ErrorBody).error.changes).toEqual([
        'MERCHANDISE',
        'DELIVERY_FEE',
        'CUSTOMER_TOTAL',
      ]);
      expect((fakeLower.body as ErrorBody).error.current).toEqual({
        merchandiseSubtotalMinor: 1200,
        deliveryFeeMinor: 500,
        customerTotalMinor: 1700,
      });
      expect((fakeLower.body as ErrorBody).error).not.toHaveProperty(
        'merchantCommissionAmountMinor',
      );

      const [firstAttempt, secondAttempt] = await Promise.all([
        request(server)
          .post('/api/v1/customer/orders')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            addressId: homeId,
            paymentMethod: 'COD',
            ...matching,
          }),
        request(server)
          .post('/api/v1/customer/orders')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            addressId: homeId,
            paymentMethod: 'COD',
            ...matching,
          }),
      ]);
      const concurrent = [firstAttempt, secondAttempt];
      const successes = concurrent.filter((row) => row.status === 201);
      const failures = concurrent.filter((row) => row.status !== 201);
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(['ORDER_CART_REQUIRED', 'ORDER_ALREADY_CREATED']).toContain(
        (failures[0].body as ErrorBody).error.code,
      );
      const created = successes[0];
      expect(created.status).toBe(201);
      const body = created.body as OrderDetailBody;
      expect(body.status).toBe('CREATED');
      expect(body.fulfillmentStatus).toBe('PENDING_ACCEPTANCE');
      expect(body.paymentMethod).toBe('COD');
      expect(body.publicReference.startsWith('sgo_')).toBe(true);
      expect(body.financial.currency).toBe('DZD');
      expect(body.financial.merchandiseSubtotalMinor).toBe(1200);
      expect(body.financial.deliveryFeeMinor).toBe(500);
      expect(body.financial.customerTotalMinor).toBe(1700);
      expect(body.financial).not.toHaveProperty(
        'merchantCommissionAmountMinor',
      );
      expect(body.financial).not.toHaveProperty('driverRemunerationMinor');
      expect(body.items).toHaveLength(1);
      expect(body.items[0].productNameSnapshot).toBe('Coffee');
      expect(body.items[0].unitPriceMinor).toBe(1200);
      expect(body.items[0].options[0].optionNameSnapshot).toBe('Large');
      expect(body.deliveryAddress.addressText).toBe('Inside zone');
      expect(body.deliveryAddress.instructions).toBeNull();

      const profile = await prisma
        .getDb()
        .orm.public.CustomerProfile.where({ accountId: accountA.id })
        .first();
      expect(profile).toBeTruthy();
      const dbOrders = await prisma
        .getDb()
        .orm.public.Order.where({ customerId: profile!.id })
        .all();
      expect(dbOrders).toHaveLength(1);
      const orderId = dbOrders[0].id;
      const financial = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({ orderId })
        .first();
      expect(financial).toBeTruthy();
      expect(Number(financial!.merchantCommissionAmountMinor)).toBe(84);
      expect(Number(financial!.commissionBaseMinor)).toBe(1200);
      expect(Number(financial!.merchantDiscountMinor)).toBe(0);
      expect(Number(financial!.driverRemunerationMinor)).toBe(300);
      expect(Number(financial!.speedyGoDeliveryShareMinor)).toBe(200);
      expect(Number(financial!.customerPayableMinor)).toBe(1700);
      const events = await prisma
        .getDb()
        .orm.public.OrderStatusEvent.where({ orderId })
        .all();
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('ORDER_CREATED');
      expect(events[0].fromStatus).toBeNull();
      expect(events[0].toStatus).toBe('CREATED');
      const deliveries = await prisma
        .getDb()
        .orm.public.Delivery.where({ orderId })
        .all();
      expect(deliveries).toHaveLength(0);
      const payments = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId })
        .all();
      expect(payments).toHaveLength(1);
      expect(payments[0].status).toBe('PENDING');
      expect(payments[0].method).toBe('COD');
      expect(Number(payments[0].amountMinor)).toBe(1700);
      expect(payments[0].currency).toBe('DZD');
      const txs = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({ paymentId: payments[0].id })
        .all();
      expect(txs).toHaveLength(0);
      const collections = await prisma
        .getDb()
        .orm.public.CodCollection.where({ orderId })
        .all();
      expect(collections).toHaveLength(0);
      const carts = await prisma
        .getDb()
        .orm.public.Cart.where({ customerId: profile!.id })
        .all();
      expect(carts).toHaveLength(1);
      expect(carts[0].status).toBe('CONVERTED');
      const activeCart = await prisma
        .getDb()
        .orm.public.Cart.where({
          customerId: profile!.id,
          status: 'ACTIVE',
        })
        .first();
      expect(activeCart).toBeNull();

      const retry = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: homeId,
          paymentMethod: 'COD',
          ...PLACEHOLDER_EXPECTED,
        });
      expect(retry.status).toBe(409);
      expect((retry.body as ErrorBody).error.code).toBe('ORDER_CART_REQUIRED');
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Order.where({ customerId: profile!.id })
            .all()
        ).length,
      ).toBe(1);

      const recount = async (): Promise<number> =>
        (
          await prisma
            .getDb()
            .orm.public.Order.where({ customerId: profile!.id })
            .all()
        ).length;

      async function addCartItem(): Promise<void> {
        const addedAgain = await request(server)
          .post('/api/v1/customer/cart/items')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ productId, quantity: 1, optionIds: [largeId] });
        expect(addedAgain.status).toBe(200);
      }

      async function expectNoPartialOrder(before: number): Promise<void> {
        expect(await recount()).toBe(before);
        const active = await prisma
          .getDb()
          .orm.public.Cart.where({
            customerId: profile!.id,
            status: 'ACTIVE',
          })
          .first();
        expect(active).not.toBeNull();
      }

      await addCartItem();
      const productPreview = await previewCheckout(tokenA, homeId);
      await prisma
        .getDb()
        .orm.public.Product.where({ id: productId })
        .update({
          priceMinor: pgBigInt(1500),
          updatedAt: pgNow(),
        });
      const productMismatch = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: homeId,
          paymentMethod: 'COD',
          ...expectedFrom(productPreview),
        });
      expect(productMismatch.status).toBe(409);
      expect((productMismatch.body as ErrorBody).error.code).toBe(
        'ORDER_RECONFIRMATION_REQUIRED',
      );
      expect((productMismatch.body as ErrorBody).error.changes).toContain(
        'MERCHANDISE',
      );
      await expectNoPartialOrder(1);
      const productRetry = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: homeId,
          paymentMethod: 'COD',
          ...expectedFrom(await previewCheckout(tokenA, homeId)),
        });
      expect(productRetry.status).toBe(201);
      expect(await recount()).toBe(2);
      await prisma
        .getDb()
        .orm.public.Product.where({ id: productId })
        .update({
          priceMinor: pgBigInt(1000),
          updatedAt: pgNow(),
        });

      await addCartItem();
      const optionPreview = await previewCheckout(tokenA, homeId);
      await prisma
        .getDb()
        .orm.public.ProductOption.where({ id: largeId })
        .update({
          additionalPriceMinor: pgBigInt(400),
          updatedAt: pgNow(),
        });
      const optionMismatch = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: homeId,
          paymentMethod: 'COD',
          ...expectedFrom(optionPreview),
        });
      expect(optionMismatch.status).toBe(409);
      expect((optionMismatch.body as ErrorBody).error.code).toBe(
        'ORDER_RECONFIRMATION_REQUIRED',
      );
      await expectNoPartialOrder(2);
      const optionRetry = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: homeId,
          paymentMethod: 'COD',
          ...expectedFrom(await previewCheckout(tokenA, homeId)),
        });
      expect(optionRetry.status).toBe(201);
      expect(await recount()).toBe(3);
      await prisma
        .getDb()
        .orm.public.ProductOption.where({ id: largeId })
        .update({
          additionalPriceMinor: pgBigInt(200),
          updatedAt: pgNow(),
        });

      await addCartItem();
      const feePreview = await previewCheckout(tokenA, homeId);
      await prisma
        .getDb()
        .orm.public.DeliveryPricingRule.where({ id: pricingRuleId })
        .update({
          customerDeliveryFeeMinor: pgBigInt(800),
          updatedAt: pgNow(),
        });
      const feeMismatch = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: homeId,
          paymentMethod: 'COD',
          ...expectedFrom(feePreview),
        });
      expect(feeMismatch.status).toBe(409);
      expect((feeMismatch.body as ErrorBody).error.code).toBe(
        'ORDER_RECONFIRMATION_REQUIRED',
      );
      expect((feeMismatch.body as ErrorBody).error.changes).toContain(
        'DELIVERY_FEE',
      );
      await expectNoPartialOrder(3);
      const feeRetry = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: homeId,
          paymentMethod: 'COD',
          ...expectedFrom(await previewCheckout(tokenA, homeId)),
        });
      expect(feeRetry.status).toBe(201);
      expect(await recount()).toBe(4);
      await prisma
        .getDb()
        .orm.public.DeliveryPricingRule.where({ id: pricingRuleId })
        .update({
          customerDeliveryFeeMinor: pgBigInt(500),
          updatedAt: pgNow(),
        });

      await prisma
        .getDb()
        .orm.public.Product.where({ id: productId })
        .update({
          name: pgVarchar<255>('Renamed Espresso'),
          priceMinor: pgBigInt(9999),
          updatedAt: pgNow(),
        });
      await prisma
        .getDb()
        .orm.public.ProductOption.where({ id: largeId })
        .update({
          name: pgVarchar<255>('Huge'),
          additionalPriceMinor: pgBigInt(999),
          updatedAt: pgNow(),
        });
      await prisma.getDb().orm.public.Address.where({ id: homeId }).update({
        addressText: 'Moved',
        updatedAt: pgNow(),
      });
      const detail = await request(server)
        .get(`/api/v1/customer/orders/${orderId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(detail.status).toBe(200);
      const historical = detail.body as OrderDetailBody;
      expect(historical.items[0].productNameSnapshot).toBe('Coffee');
      expect(historical.items[0].unitPriceMinor).toBe(1200);
      expect(historical.items[0].options[0].optionNameSnapshot).toBe('Large');
      expect(historical.items[0].options[0].additionalPriceMinor).toBe(200);
      expect(historical.deliveryAddress.addressText).toBe('Inside zone');

      const listed = await request(server)
        .get('/api/v1/customer/orders?limit=10&offset=0')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(listed.status).toBe(200);
      expect((listed.body as { items: unknown[]; total: number }).total).toBe(
        4,
      );

      const foreignRead = await request(server)
        .get(`/api/v1/customer/orders/${orderId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(foreignRead.status).toBe(404);
      expect((foreignRead.body as ErrorBody).error.code).toBe(
        'ORDER_NOT_FOUND',
      );

      const inUse = await request(server)
        .delete(`/api/v1/merchant/${merchantId}/products/${productId}`)
        .set('Authorization', `Bearer ${tokenMerchant}`);
      expect(inUse.status).toBe(409);
      expect((inUse.body as ErrorBody).error.code).toBe(
        'CATALOG_PRODUCT_IN_USE',
      );

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
      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId, quantity: 1, optionIds: [largeId] });
      const ambiguous = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: homeId,
          paymentMethod: 'COD',
          ...PLACEHOLDER_EXPECTED,
        });
      expect(ambiguous.status).toBe(409);
      expect((ambiguous.body as ErrorBody).error.code).toBe(
        'ORDER_DELIVERY_ZONE_AMBIGUOUS',
      );

      await prisma
        .getDb()
        .orm.public.DeliveryZone.where({ id: overlapId })
        .update({ active: false, updatedAt: pgNow() });
      const boundaryOrder = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          addressId: boundaryId,
          paymentMethod: 'ELECTRONIC',
          ...expectedFrom(await previewCheckout(tokenA, boundaryId)),
        });
      expect(boundaryOrder.status).toBe(201);
      expect((boundaryOrder.body as OrderDetailBody).paymentMethod).toBe(
        'ELECTRONIC',
      );
    } finally {
      await cleanupByPhone(e164[0] ?? '');
      await cleanupByPhone(e164[1] ?? '');
      await cleanupCommission(adminIds, roleIds);
      await cleanupZones(zoneIds);
      await cleanupByPhone(e164[2] ?? '');
    }
  });
});
