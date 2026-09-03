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
import { MerchantCommissionService } from '../src/modules/merchant-commissions/application/merchant-commission.service';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string } };
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
type AddressBody = { id: string };
type OrderDetailBody = {
  id: string;
  paymentMethod: string;
  financial: {
    merchandiseSubtotalMinor: number;
    deliveryFeeMinor: number;
    customerTotalMinor: number;
  };
};
type MerchantOrderBody = {
  financial: {
    merchantCommissionRateBps: number;
    merchantCommissionAmountMinor: number;
    merchantNetAmountMinor: number;
    deliveryFeeMinor: number;
  };
};

const INSIDE: [number, number] = [36.75, 3.05];
const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

describe('Merchant Commission Foundation (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let commission: MerchantCommissionService;

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
    commission = app.get(MerchantCommissionService);
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
        deviceName: 'commission-e2e',
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
        const items = await prisma
          .getDb()
          .orm.public.CartItem.where({ cartId: cart.id })
          .all();
        for (const item of items) {
          const options = await prisma
            .getDb()
            .orm.public.CartItemOption.where({ cartItemId: item.id })
            .all();
          for (const option of options) {
            await prisma
              .getDb()
              .orm.public.CartItemOption.where({ id: option.id })
              .delete();
          }
          await prisma
            .getDb()
            .orm.public.CartItem.where({ id: item.id })
            .delete();
        }
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

  it('snapshots future-only commission rules with override priority and privacy', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0571${suffix}`,
      merchantA: `0572${suffix}`,
      merchantB: `0573${suffix}`,
      staff: `0574${suffix}`,
    };
    const e164: string[] = [];
    const zoneIds: string[] = [];
    const adminIds: string[] = [];
    const roleIds: string[] = [];
    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenA = await authenticate(phones.merchantA);
      const tokenB = await authenticate(phones.merchantB);
      const tokenStaff = await authenticate(phones.staff);
      e164.push(
        (await authMe(tokenCustomer)).phone,
        (await authMe(tokenA)).phone,
        (await authMe(tokenB)).phone,
        (await authMe(tokenStaff)).phone,
      );

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'Commission Customer' });
      const home = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          label: 'Home',
          addressText: 'Inside',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const addressId = (home.body as AddressBody).id;

      async function setupMerchant(token: string, name: string) {
        const merchant = await request(server)
          .post('/api/v1/merchant/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ name });
        expect(merchant.status).toBe(201);
        const merchantId = (merchant.body as MembershipBody).merchantId;
        const branch = await request(server)
          .post(`/api/v1/merchant/${merchantId}/branches`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: 'Main',
            phone: '0550123488',
            addressText: 'Street',
            latitude: 36.75,
            longitude: 3.05,
          });
        const branchId = (branch.body as BranchBody).id;
        await approveMerchant(merchantId);
        const category = await request(server)
          .post(`/api/v1/merchant/${merchantId}/categories`)
          .set('Authorization', `Bearer ${token}`)
          .send({ branchId, name: 'Drinks' });
        const product = await request(server)
          .post(`/api/v1/merchant/${merchantId}/products`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            branchId,
            categoryId: (category.body as CategoryBody).id,
            name: 'Coffee',
            priceMinor: 1200,
          });
        return {
          merchantId,
          productId: (product.body as ProductBody).id,
        };
      }

      const merchantA = await setupMerchant(tokenA, 'Cafe A');
      const merchantB = await setupMerchant(tokenB, 'Cafe B');

      const now = pgNow();
      const zoneId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Commission zone ${suffix}`),
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

      const accountA = await authMe(tokenA);
      const roleId = createUuidV7();
      await prisma.getDb().orm.public.Role.create({
        id: roleId,
        name: pgVarchar<128>(`commission-e2e-${suffix}`),
        description: null,
        active: true,
      });
      roleIds.push(roleId);
      const adminId = createUuidV7();
      await prisma.getDb().orm.public.AdminProfile.create({
        id: adminId,
        accountId: accountA.id,
        roleId,
        displayName: pgVarchar<255>('Commission E2E Admin'),
        twoFactorEnabled: false,
        createdAt: now,
        updatedAt: now,
      });
      adminIds.push(adminId);

      const global = await commission.createRule({
        scope: 'GLOBAL_DEFAULT',
        rateBps: 700,
        changedByAdminId: adminId,
        effectiveFrom: '2020-01-01T00:00:00.000Z',
      });
      expect(global.rateBps).toBe(700);

      const missingAdmin = await request(server)
        .post('/api/v1/admin/commission-rules')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ rateBps: 1 });
      expect(missingAdmin.status).toBeGreaterThanOrEqual(400);

      async function orderFromProduct(
        productId: string,
        paymentMethod: 'COD' | 'ELECTRONIC',
      ) {
        await request(server)
          .post('/api/v1/customer/cart/items')
          .set('Authorization', `Bearer ${tokenCustomer}`)
          .send({ productId, quantity: 1, optionIds: [] });
        const preview = await request(server)
          .post('/api/v1/customer/checkout/preview')
          .set('Authorization', `Bearer ${tokenCustomer}`)
          .send({ addressId });
        expect(preview.body).not.toHaveProperty(
          'merchantCommissionAmountMinor',
        );
        const created = await request(server)
          .post('/api/v1/customer/orders')
          .set('Authorization', `Bearer ${tokenCustomer}`)
          .send({
            addressId,
            paymentMethod,
            expectedMerchandiseSubtotalMinor: (preview.body as PreviewBody)
              .merchandiseSubtotalMinor,
            expectedDeliveryFeeMinor: (preview.body as PreviewBody)
              .deliveryFeeMinor,
            expectedCustomerTotalMinor: (preview.body as PreviewBody)
              .customerTotalMinor,
          });
        expect(created.status).toBe(201);
        const body = created.body as OrderDetailBody;
        expect(body.financial).not.toHaveProperty(
          'merchantCommissionAmountMinor',
        );
        expect(body.financial).not.toHaveProperty('merchantNetAmountMinor');
        return body;
      }

      const codOrder = await orderFromProduct(merchantA.productId, 'COD');
      const electronicOrder = await orderFromProduct(
        merchantA.productId,
        'ELECTRONIC',
      );
      const snapshotCod = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({ orderId: codOrder.id })
        .first();
      const snapshotEl = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({
          orderId: electronicOrder.id,
        })
        .first();
      expect(snapshotCod?.merchantCommissionRateBps).toBe(700);
      expect(Number(snapshotCod?.merchantCommissionAmountMinor)).toBe(84);
      expect(Number(snapshotCod?.merchantNetAmountMinor)).toBe(1116);
      expect(snapshotEl?.merchantCommissionRateBps).toBe(
        snapshotCod?.merchantCommissionRateBps,
      );
      expect(Number(snapshotEl?.merchantCommissionAmountMinor)).toBe(84);

      const merchantRead = await request(server)
        .get(`/api/v1/merchant/${merchantA.merchantId}/orders/${codOrder.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(merchantRead.status).toBe(200);
      const merchantFinancial = (merchantRead.body as MerchantOrderBody)
        .financial;
      expect(merchantFinancial.merchantCommissionRateBps).toBe(700);
      expect(merchantFinancial.merchantCommissionAmountMinor).toBe(84);
      expect(merchantFinancial).not.toHaveProperty('driverRemunerationMinor');

      const live = await request(server)
        .get(`/api/v1/merchant/${merchantA.merchantId}/commission`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(live.status).toBe(200);
      expect((live.body as { rateBps: number; scope: string }).rateBps).toBe(
        700,
      );
      expect((live.body as { scope: string }).scope).toBe('GLOBAL_DEFAULT');

      const staffAccount = await authMe(tokenStaff);
      await prisma.getDb().orm.public.MerchantMember.create({
        id: createUuidV7(),
        merchantId: merchantA.merchantId,
        accountId: staffAccount.id,
        role: pgVarchar<64>('STAFF'),
        createdAt: pgNow(),
      });
      const staffLive = await request(server)
        .get(`/api/v1/merchant/${merchantA.merchantId}/commission`)
        .set('Authorization', `Bearer ${tokenStaff}`);
      expect(staffLive.status).toBe(403);
      expect((staffLive.body as ErrorBody).error.code).toBe(
        'MERCHANT_ROLE_FORBIDDEN',
      );

      const override = await commission.createRule({
        scope: 'MERCHANT_OVERRIDE',
        merchantId: merchantA.merchantId,
        rateBps: 400,
        changedByAdminId: adminId,
        effectiveFrom: '2020-01-01T00:00:00.000Z',
      });
      expect(override.scope).toBe('MERCHANT_OVERRIDE');

      const afterOverride = await orderFromProduct(merchantA.productId, 'COD');
      const snapshotOverride = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({
          orderId: afterOverride.id,
        })
        .first();
      expect(snapshotOverride?.merchantCommissionRateBps).toBe(400);
      expect(Number(snapshotOverride?.merchantCommissionAmountMinor)).toBe(48);
      expect(Number(snapshotCod?.merchantCommissionAmountMinor)).toBe(84);

      const bOrder = await orderFromProduct(merchantB.productId, 'COD');
      const snapshotB = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({ orderId: bOrder.id })
        .first();
      expect(snapshotB?.merchantCommissionRateBps).toBe(700);

      const liveOverride = await request(server)
        .get(`/api/v1/merchant/${merchantA.merchantId}/commission`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(
        (liveOverride.body as { rateBps: number; scope: string }).rateBps,
      ).toBe(400);
      expect((liveOverride.body as { scope: string }).scope).toBe(
        'MERCHANT_OVERRIDE',
      );

      await commission.deactivateRule(override.id);
      const afterDeactivate = await orderFromProduct(
        merchantA.productId,
        'COD',
      );
      const snapshotFallback = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({
          orderId: afterDeactivate.id,
        })
        .first();
      expect(snapshotFallback?.merchantCommissionRateBps).toBe(700);
      expect(Number(snapshotOverride?.merchantCommissionAmountMinor)).toBe(48);

      const extraGlobalId = createUuidV7();
      await prisma.getDb().orm.public.MerchantCommissionRule.create({
        id: extraGlobalId,
        scope: 'GLOBAL_DEFAULT',
        merchantId: null,
        rateBps: 1000,
        effectiveFrom: pgTimestamptz('2020-01-01T00:00:00.000Z'),
        effectiveTo: null,
        changeReason: null,
        changedByAdminId: adminId,
        active: true,
        createdAt: pgNow(),
      });
      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ productId: merchantA.productId, quantity: 1, optionIds: [] });
      const previewAmbiguous = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ addressId });
      const ambiguousOrder = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          addressId,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: (
            previewAmbiguous.body as PreviewBody
          ).merchandiseSubtotalMinor,
          expectedDeliveryFeeMinor: (previewAmbiguous.body as PreviewBody)
            .deliveryFeeMinor,
          expectedCustomerTotalMinor: (previewAmbiguous.body as PreviewBody)
            .customerTotalMinor,
        });
      expect(ambiguousOrder.status).toBe(409);
      expect((ambiguousOrder.body as ErrorBody).error.code).toBe(
        'ORDER_FINANCIAL_CONFIGURATION_INVALID',
      );
      await prisma
        .getDb()
        .orm.public.MerchantCommissionRule.where({ id: extraGlobalId })
        .delete();

      const settlements = await prisma
        .getDb()
        .orm.public.MerchantSettlement.where({
          merchantId: merchantA.merchantId,
        })
        .all();
      expect(settlements).toHaveLength(0);
      const lines = await prisma
        .getDb()
        .orm.public.MerchantSettlementLine.where({ orderId: codOrder.id })
        .all();
      expect(lines).toHaveLength(0);
    } finally {
      if (e164[0]) {
        await cleanupByPhone(e164[0]);
      }
      await cleanupCommission(adminIds, roleIds);
      for (const phone of e164.slice(1)) {
        await cleanupByPhone(phone);
      }
      for (const zoneId of zoneIds) {
        const pricing = await prisma
          .getDb()
          .orm.public.DeliveryPricingRule.where({ zoneId })
          .all();
        for (const rule of pricing) {
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
  });

  it('fails Order creation closed when no applicable commission rule exists', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}8`;
    const phones = {
      customer: `0561${suffix}`,
      merchant: `0562${suffix}`,
    };
    const e164: string[] = [];
    const zoneIds: string[] = [];
    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenMerchant = await authenticate(phones.merchant);
      e164.push(
        (await authMe(tokenCustomer)).phone,
        (await authMe(tokenMerchant)).phone,
      );
      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'No Rule Customer' });
      const home = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          label: 'Home',
          addressText: 'Inside',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ name: 'No Rule Cafe' });
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'Main',
          phone: '0550123488',
          addressText: 'Street',
          latitude: 36.75,
          longitude: 3.05,
        });
      await approveMerchant(merchantId);
      const category = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          branchId: (branch.body as BranchBody).id,
          name: 'Drinks',
        });
      const product = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          branchId: (branch.body as BranchBody).id,
          categoryId: (category.body as CategoryBody).id,
          name: 'Coffee',
          priceMinor: 1200,
        });
      const now = pgNow();
      const zoneId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Commission none ${suffix}`),
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
      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          productId: (product.body as ProductBody).id,
          quantity: 1,
          optionIds: [],
        });
      const preview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ addressId: (home.body as AddressBody).id });
      const created = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          addressId: (home.body as AddressBody).id,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: (preview.body as PreviewBody)
            .merchandiseSubtotalMinor,
          expectedDeliveryFeeMinor: (preview.body as PreviewBody)
            .deliveryFeeMinor,
          expectedCustomerTotalMinor: (preview.body as PreviewBody)
            .customerTotalMinor,
        });
      expect(created.status).toBe(409);
      expect((created.body as ErrorBody).error.code).toBe(
        'ORDER_FINANCIAL_CONFIGURATION_INVALID',
      );
      const account = await authMe(tokenCustomer);
      const profile = await prisma
        .getDb()
        .orm.public.CustomerProfile.where({ accountId: account.id })
        .first();
      const orders = profile
        ? await prisma
            .getDb()
            .orm.public.Order.where({ customerId: profile.id })
            .all()
        : [];
      expect(orders).toHaveLength(0);
    } finally {
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
      for (const zoneId of zoneIds) {
        const pricing = await prisma
          .getDb()
          .orm.public.DeliveryPricingRule.where({ zoneId })
          .all();
        for (const rule of pricing) {
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
  });

  it('serializes concurrent GLOBAL_DEFAULT creates so only one overlapping rule wins', async () => {
    const suffix = `${Date.now().toString().slice(-5)}7`;
    const phone = `0563${suffix}`;
    const adminIds: string[] = [];
    const roleIds: string[] = [];
    const pausedGlobals: string[] = [];
    let phoneE164: string | null = null;
    try {
      const token = await authenticate(phone);
      const account = await authMe(token);
      phoneE164 = account.phone;
      const roleId = createUuidV7();
      await prisma.getDb().orm.public.Role.create({
        id: roleId,
        name: pgVarchar<128>(`commission-race-g-${suffix}`),
        description: null,
        active: true,
      });
      roleIds.push(roleId);
      const adminId = createUuidV7();
      await prisma.getDb().orm.public.AdminProfile.create({
        id: adminId,
        accountId: account.id,
        roleId,
        displayName: pgVarchar<255>('Commission Race Global'),
        twoFactorEnabled: false,
        createdAt: pgNow(),
        updatedAt: pgNow(),
      });
      adminIds.push(adminId);

      const existingGlobals = await prisma
        .getDb()
        .orm.public.MerchantCommissionRule.where({
          scope: 'GLOBAL_DEFAULT',
          active: true,
        })
        .all();
      for (const row of existingGlobals) {
        await prisma
          .getDb()
          .orm.public.MerchantCommissionRule.where({ id: row.id })
          .update({ active: false });
        pausedGlobals.push(row.id);
      }

      const results = await Promise.allSettled([
        commission.createRule({
          scope: 'GLOBAL_DEFAULT',
          rateBps: 500,
          changedByAdminId: adminId,
          effectiveFrom: '2020-01-01T00:00:00.000Z',
        }),
        commission.createRule({
          scope: 'GLOBAL_DEFAULT',
          rateBps: 600,
          changedByAdminId: adminId,
          effectiveFrom: '2020-01-01T00:00:00.000Z',
        }),
      ]);
      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled',
      );
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const active = await prisma
        .getDb()
        .orm.public.MerchantCommissionRule.where({
          scope: 'GLOBAL_DEFAULT',
          active: true,
        })
        .all();
      expect(active).toHaveLength(1);
    } finally {
      await cleanupCommission(adminIds, roleIds);
      for (const id of pausedGlobals) {
        await prisma
          .getDb()
          .orm.public.MerchantCommissionRule.where({ id })
          .update({ active: true });
      }
      if (phoneE164) {
        await cleanupByPhone(phoneE164);
      }
    }
  });

  it('serializes same-Merchant override races and allows different Merchants in parallel', async () => {
    const suffix = `${Date.now().toString().slice(-5)}6`;
    const phones = {
      ownerA: `0564${suffix}`,
      ownerB: `0565${suffix}`,
    };
    const e164: string[] = [];
    const adminIds: string[] = [];
    const roleIds: string[] = [];
    try {
      const tokenA = await authenticate(phones.ownerA);
      const tokenB = await authenticate(phones.ownerB);
      const accountA = await authMe(tokenA);
      const accountB = await authMe(tokenB);
      e164.push(accountA.phone, accountB.phone);

      const merchantA = await request(app.getHttpServer())
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Race Cafe A' });
      const merchantB = await request(app.getHttpServer())
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Race Cafe B' });
      const merchantAId = (merchantA.body as MembershipBody).merchantId;
      const merchantBId = (merchantB.body as MembershipBody).merchantId;

      const roleId = createUuidV7();
      await prisma.getDb().orm.public.Role.create({
        id: roleId,
        name: pgVarchar<128>(`commission-race-m-${suffix}`),
        description: null,
        active: true,
      });
      roleIds.push(roleId);
      const adminId = createUuidV7();
      await prisma.getDb().orm.public.AdminProfile.create({
        id: adminId,
        accountId: accountA.id,
        roleId,
        displayName: pgVarchar<255>('Commission Race Merchant'),
        twoFactorEnabled: false,
        createdAt: pgNow(),
        updatedAt: pgNow(),
      });
      adminIds.push(adminId);

      const sameMerchant = await Promise.allSettled([
        commission.createRule({
          scope: 'MERCHANT_OVERRIDE',
          merchantId: merchantAId,
          rateBps: 300,
          changedByAdminId: adminId,
          effectiveFrom: '2020-01-01T00:00:00.000Z',
        }),
        commission.createRule({
          scope: 'MERCHANT_OVERRIDE',
          merchantId: merchantAId,
          rateBps: 350,
          changedByAdminId: adminId,
          effectiveFrom: '2020-01-01T00:00:00.000Z',
        }),
      ]);
      expect(
        sameMerchant.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        sameMerchant.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
      const activeA = await prisma
        .getDb()
        .orm.public.MerchantCommissionRule.where({
          merchantId: merchantAId,
          scope: 'MERCHANT_OVERRIDE',
          active: true,
        })
        .all();
      expect(activeA).toHaveLength(1);

      const parallel = await Promise.allSettled([
        commission.createRule({
          scope: 'MERCHANT_OVERRIDE',
          merchantId: merchantBId,
          rateBps: 200,
          changedByAdminId: adminId,
          effectiveFrom: '2020-01-01T00:00:00.000Z',
        }),
        commission.createRule({
          scope: 'MERCHANT_OVERRIDE',
          merchantId: merchantAId,
          rateBps: 250,
          changedByAdminId: adminId,
          effectiveFrom: '2099-01-01T00:00:00.000Z',
          effectiveTo: '2099-12-31T00:00:00.000Z',
        }),
      ]);
      // Merchant B override succeeds; Merchant A future non-overlapping window may succeed.
      expect(
        parallel.filter((result) => result.status === 'fulfilled').length,
      ).toBeGreaterThanOrEqual(1);
      const activeB = await prisma
        .getDb()
        .orm.public.MerchantCommissionRule.where({
          merchantId: merchantBId,
          scope: 'MERCHANT_OVERRIDE',
          active: true,
        })
        .all();
      expect(activeB).toHaveLength(1);

      const winner = (
        sameMerchant.find(
          (result) => result.status === 'fulfilled',
        ) as PromiseFulfilledResult<{ id: string }>
      ).value;
      const createVsDeactivate = await Promise.allSettled([
        commission.deactivateRule(winner.id),
        commission.createRule({
          scope: 'MERCHANT_OVERRIDE',
          merchantId: merchantAId,
          rateBps: 450,
          changedByAdminId: adminId,
          effectiveFrom: '2020-01-01T00:00:00.000Z',
        }),
      ]);
      const activeAfterRace = await prisma
        .getDb()
        .orm.public.MerchantCommissionRule.where({
          merchantId: merchantAId,
          scope: 'MERCHANT_OVERRIDE',
          active: true,
        })
        .all();
      const overlappingNow = activeAfterRace.filter((row) => {
        const from = Date.parse(row.effectiveFrom);
        const to = row.effectiveTo ? Date.parse(row.effectiveTo) : Infinity;
        const now = Date.now();
        return row.active && from <= now && now < to;
      });
      expect(overlappingNow.length).toBeLessThanOrEqual(1);
      expect(
        createVsDeactivate.every(
          (result) =>
            result.status === 'fulfilled' || result.status === 'rejected',
        ),
      ).toBe(true);
    } finally {
      await cleanupCommission(adminIds, roleIds);
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });
});
