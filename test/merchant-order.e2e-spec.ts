import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
type PreviewBody = {
  merchandiseSubtotalMinor: number;
  deliveryFeeMinor: number;
  customerTotalMinor: number;
};
type MerchantOrderDetail = {
  id: string;
  status: string;
  fulfillmentStatus: string;
  confirmedAt: string | null;
  customerFullName: string | null;
  payment: { method: string; status: string };
  financial: {
    grossMerchandiseSubtotalMinor: number;
    merchantNetAmountMinor: number;
    merchantCommissionAmountMinor: number;
  };
  items: Array<{
    productNameSnapshot: string;
    unitPriceMinor: number;
    options: Array<{ additionalPriceMinor: number }>;
  }>;
  statusHistory: Array<{ eventType: string; actorType: string }>;
};

const INSIDE: [number, number] = [36.75, 3.05];
const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

describe('Merchant order workflow (e2e)', () => {
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
        deviceName: 'merchant-order-e2e',
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
        const assignments = await prisma
          .getDb()
          .orm.public.DriverAssignment.where({ deliveryId: delivery.id })
          .all();
        for (const assignment of assignments) {
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
    const leftoverMembers = await prisma
      .getDb()
      .orm.public.MerchantMember.where({ accountId: account.id })
      .all();
    for (const member of leftoverMembers) {
      await prisma
        .getDb()
        .orm.public.MerchantMember.where({ id: member.id })
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

  it('runs Merchant accept / prepare / ready without Delivery or payment execution', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0581${suffix}`,
      owner: `0582${suffix}`,
      manager: `0583${suffix}`,
      staff: `0584${suffix}`,
      other: `0585${suffix}`,
    };
    const e164: string[] = [];
    const zoneIds: string[] = [];
    const adminIds: string[] = [];
    const roleIds: string[] = [];
    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenOwner = await authenticate(phones.owner);
      const tokenManager = await authenticate(phones.manager);
      const tokenStaff = await authenticate(phones.staff);
      const tokenOther = await authenticate(phones.other);
      const accountCustomer = await authMe(tokenCustomer);
      const accountOwner = await authMe(tokenOwner);
      const accountManager = await authMe(tokenManager);
      const accountStaff = await authMe(tokenStaff);
      e164.push(
        accountCustomer.phone,
        accountOwner.phone,
        accountManager.phone,
        accountStaff.phone,
        (await authMe(tokenOther)).phone,
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
          addressText: 'Inside zone',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      expect(home.status).toBe(201);
      const homeId = (home.body as AddressBody).id;

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Workflow Cafe' });
      expect(merchant.status).toBe(201);
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const otherMerchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOther}`)
        .send({ name: 'Other Cafe' });
      expect(otherMerchant.status).toBe(201);
      const otherMerchantId = (otherMerchant.body as MembershipBody).merchantId;
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
      expect(branch.status).toBe(201);
      const branchId = (branch.body as BranchBody).id;
      await approveMerchant(merchantId);
      await approveMerchant(otherMerchantId);

      const now = pgNow();
      await prisma.getDb().orm.public.MerchantMember.create({
        id: createUuidV7(),
        merchantId,
        accountId: accountManager.id,
        role: pgVarchar<64>('MANAGER'),
        createdAt: now,
      });
      await prisma.getDb().orm.public.MerchantMember.create({
        id: createUuidV7(),
        merchantId,
        accountId: accountStaff.id,
        role: pgVarchar<64>('STAFF'),
        createdAt: now,
      });

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
      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ productId, quantity: 1, optionIds: [largeId] });

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
        name: pgVarchar<128>(`workflow-e2e-${suffix}`),
        description: null,
        active: true,
      });
      roleIds.push(roleId);
      const adminId = createUuidV7();
      await prisma.getDb().orm.public.AdminProfile.create({
        id: adminId,
        accountId: accountOwner.id,
        roleId,
        displayName: pgVarchar<255>('Workflow E2E Admin'),
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

      const preview = await previewCheckout(tokenCustomer, homeId);
      const created = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          addressId: homeId,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: preview.merchandiseSubtotalMinor,
          expectedDeliveryFeeMinor: preview.deliveryFeeMinor,
          expectedCustomerTotalMinor: preview.customerTotalMinor,
        });
      expect(created.status).toBe(201);
      const orderId = (created.body as { id: string }).id;
      expect((created.body as { status: string }).status).toBe('CREATED');
      expect(
        (created.body as { fulfillmentStatus: string }).fulfillmentStatus,
      ).toBe('PENDING_ACCEPTANCE');

      const listed = await request(server)
        .get(`/api/v1/merchant/${merchantId}/orders`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(listed.status).toBe(200);
      expect((listed.body as { total: number }).total).toBe(1);

      const staffList = await request(server)
        .get(`/api/v1/merchant/${merchantId}/orders`)
        .set('Authorization', `Bearer ${tokenStaff}`);
      expect(staffList.status).toBe(200);

      const detail = await request(server)
        .get(`/api/v1/merchant/${merchantId}/orders/${orderId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(detail.status).toBe(200);
      const before = detail.body as MerchantOrderDetail;
      expect(before.customerFullName).toBe('Workflow Customer');
      expect(before.financial).not.toHaveProperty('driverRemunerationMinor');
      const snapshotNet = before.financial.merchantNetAmountMinor;
      const snapshotUnit = before.items[0].unitPriceMinor;

      const staffAccept = await request(server)
        .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/accept`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({});
      expect(staffAccept.status).toBe(403);
      expect((staffAccept.body as ErrorBody).error.code).toBe(
        'MERCHANT_ROLE_FORBIDDEN',
      );

      const foreignList = await request(server)
        .get(`/api/v1/merchant/${otherMerchantId}/orders`)
        .set('Authorization', `Bearer ${tokenOther}`);
      expect(foreignList.status).toBe(200);
      expect((foreignList.body as { total: number }).total).toBe(0);
      const foreignGet = await request(server)
        .get(`/api/v1/merchant/${otherMerchantId}/orders/${orderId}`)
        .set('Authorization', `Bearer ${tokenOther}`);
      expect(foreignGet.status).toBe(404);
      expect((foreignGet.body as ErrorBody).error.code).toBe(
        'MERCHANT_ORDER_NOT_FOUND',
      );
      const foreignAccept = await request(server)
        .post(`/api/v1/merchant/${otherMerchantId}/orders/${orderId}/accept`)
        .set('Authorization', `Bearer ${tokenOther}`)
        .send({});
      expect(foreignAccept.status).toBe(404);

      const [firstAccept, secondAccept] = await Promise.all([
        request(server)
          .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/accept`)
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({}),
        request(server)
          .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/accept`)
          .set('Authorization', `Bearer ${tokenManager}`)
          .send({}),
      ]);
      const acceptResults = [firstAccept, secondAccept];
      expect(acceptResults.filter((row) => row.status === 200)).toHaveLength(1);
      expect(acceptResults.filter((row) => row.status !== 200)).toHaveLength(1);
      const accepted = acceptResults.find((row) => row.status === 200)
        ?.body as MerchantOrderDetail;
      expect(accepted.status).toBe('CONFIRMED');
      expect(accepted.fulfillmentStatus).toBe('ACCEPTED');
      expect(accepted.confirmedAt).toBeTruthy();
      expect(
        accepted.statusHistory.filter(
          (event) => event.eventType === 'MERCHANT_ACCEPTED',
        ),
      ).toHaveLength(1);
      const lostAccept = acceptResults.find((row) => row.status !== 200);
      expect((lostAccept?.body as ErrorBody).error.code).toBe(
        'MERCHANT_ORDER_ALREADY_ACCEPTED',
      );

      const [firstPrep, secondPrep] = await Promise.all([
        request(server)
          .post(
            `/api/v1/merchant/${merchantId}/orders/${orderId}/start-preparation`,
          )
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({}),
        request(server)
          .post(
            `/api/v1/merchant/${merchantId}/orders/${orderId}/start-preparation`,
          )
          .set('Authorization', `Bearer ${tokenManager}`)
          .send({}),
      ]);
      expect(
        [firstPrep, secondPrep].filter((row) => row.status === 200),
      ).toHaveLength(1);
      expect(
        [firstPrep, secondPrep].filter((row) => row.status !== 200),
      ).toHaveLength(1);
      const preparing = [firstPrep, secondPrep].find(
        (row) => row.status === 200,
      )?.body as MerchantOrderDetail;
      expect(preparing.status).toBe('ACTIVE');
      expect(preparing.fulfillmentStatus).toBe('PREPARING');

      const [firstReady, secondReady] = await Promise.all([
        request(server)
          .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/mark-ready`)
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({}),
        request(server)
          .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/mark-ready`)
          .set('Authorization', `Bearer ${tokenManager}`)
          .send({}),
      ]);
      expect(
        [firstReady, secondReady].filter((row) => row.status === 200),
      ).toHaveLength(1);
      const ready = [firstReady, secondReady].find((row) => row.status === 200)
        ?.body as MerchantOrderDetail;
      expect(ready.status).toBe('ACTIVE');
      expect(ready.fulfillmentStatus).toBe('READY');
      expect(ready.items[0].unitPriceMinor).toBe(snapshotUnit);
      expect(ready.financial.merchantNetAmountMinor).toBe(snapshotNet);
      expect(ready.payment.status).toBe('PENDING');
      expect(
        ready.statusHistory.filter(
          (event) => event.eventType === 'ORDER_READY',
        ),
      ).toHaveLength(1);

      const deliveries = await prisma
        .getDb()
        .orm.public.Delivery.where({ orderId })
        .all();
      expect(deliveries.length).toBeLessThanOrEqual(1);
      if (deliveries[0]) {
        expect(deliveries[0].status).toBe('SEARCHING_DRIVER');
      }
      const payment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId })
        .first();
      expect(payment?.status).toBe('PENDING');
      expect(payment?.method).toBe('COD');
      const txs = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({ paymentId: payment!.id })
        .all();
      expect(txs).toHaveLength(0);
      const events = await prisma
        .getDb()
        .orm.public.OrderStatusEvent.where({ orderId })
        .all();
      expect(
        events.filter((event) => event.eventType === 'MERCHANT_ACCEPTED'),
      ).toHaveLength(1);
      expect(
        events.filter((event) => event.eventType === 'PREPARATION_STARTED'),
      ).toHaveLength(1);
      expect(
        events.filter((event) => event.eventType === 'ORDER_READY'),
      ).toHaveLength(1);

      const customerRead = await request(server)
        .get(`/api/v1/customer/orders/${orderId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(customerRead.status).toBe(200);
      expect((customerRead.body as { status: string }).status).toBe('ACTIVE');

      const invalidReady = await request(server)
        .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/accept`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(invalidReady.status).toBe(409);

      async function createFollowOnOrder(
        paymentMethod: 'COD' | 'ELECTRONIC',
      ): Promise<string> {
        await request(server)
          .post('/api/v1/customer/cart/items')
          .set('Authorization', `Bearer ${tokenCustomer}`)
          .send({ productId, quantity: 1, optionIds: [largeId] });
        const nextPreview = await previewCheckout(tokenCustomer, homeId);
        const next = await request(server)
          .post('/api/v1/customer/orders')
          .set('Authorization', `Bearer ${tokenCustomer}`)
          .send({
            addressId: homeId,
            paymentMethod,
            expectedMerchandiseSubtotalMinor:
              nextPreview.merchandiseSubtotalMinor,
            expectedDeliveryFeeMinor: nextPreview.deliveryFeeMinor,
            expectedCustomerTotalMinor: nextPreview.customerTotalMinor,
          });
        expect(next.status).toBe(201);
        return (next.body as { id: string }).id;
      }

      const paidRejectId = await createFollowOnOrder('ELECTRONIC');
      await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: paidRejectId })
        .update({
          status: 'SUCCEEDED',
          updatedAt: pgNow(),
        });
      const paidReject = await request(server)
        .post(`/api/v1/merchant/${merchantId}/orders/${paidRejectId}/reject`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ reason: 'Cannot cancel paid intent' });
      expect(paidReject.status).toBe(409);
      expect((paidReject.body as ErrorBody).error.code).toBe(
        'MERCHANT_ORDER_REJECTION_REQUIRES_CANCELLATION_FLOW',
      );
      const paidOrder = await prisma
        .getDb()
        .orm.public.Order.where({ id: paidRejectId })
        .first();
      expect(paidOrder?.status).toBe('CREATED');
      const paidPayment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: paidRejectId })
        .first();
      expect(paidPayment?.status).toBe('SUCCEEDED');
      expect(
        await prisma
          .getDb()
          .orm.public.OrderCancellation.where({ orderId: paidRejectId })
          .first(),
      ).toBeNull();

      const rejectOrderId = await createFollowOnOrder('COD');
      const rejectPaymentBefore = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: rejectOrderId })
        .first();
      const staffReject = await request(server)
        .post(`/api/v1/merchant/${merchantId}/orders/${rejectOrderId}/reject`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({ reason: 'Staff cannot reject' });
      expect(staffReject.status).toBe(403);
      const foreignReject = await request(server)
        .post(
          `/api/v1/merchant/${otherMerchantId}/orders/${rejectOrderId}/reject`,
        )
        .set('Authorization', `Bearer ${tokenOther}`)
        .send({ reason: 'Not my order' });
      expect(foreignReject.status).toBe(404);
      const rejected = await request(server)
        .post(`/api/v1/merchant/${merchantId}/orders/${rejectOrderId}/reject`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ reason: 'Out of stock' });
      expect(rejected.status).toBe(200);
      const rejectedBody = rejected.body as MerchantOrderDetail & {
        cancellation: { reason: string } | null;
      };
      expect(rejectedBody.status).toBe('CANCELLED');
      expect(rejectedBody.fulfillmentStatus).toBe('PENDING_ACCEPTANCE');
      expect(rejectedBody.payment.status).toBe('CANCELLED');
      expect(rejectedBody.cancellation?.reason).toBe('Out of stock');
      expect(
        rejectedBody.statusHistory.filter(
          (event) => event.eventType === 'MERCHANT_REJECTED',
        ),
      ).toHaveLength(1);
      const repeatReject = await request(server)
        .post(`/api/v1/merchant/${merchantId}/orders/${rejectOrderId}/reject`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ reason: 'Again' });
      expect(repeatReject.status).toBe(409);
      expect((repeatReject.body as ErrorBody).error.code).toBe(
        'MERCHANT_ORDER_NOT_REJECTABLE',
      );
      expect(
        await prisma
          .getDb()
          .orm.public.OrderCancellation.where({ orderId: rejectOrderId })
          .all(),
      ).toHaveLength(1);
      expect(
        await prisma
          .getDb()
          .orm.public.Refund.where({ orderId: rejectOrderId })
          .all(),
      ).toHaveLength(0);
      expect(
        await prisma
          .getDb()
          .orm.public.CodCollection.where({ orderId: rejectOrderId })
          .all(),
      ).toHaveLength(0);
      expect(
        await prisma
          .getDb()
          .orm.public.Delivery.where({ orderId: rejectOrderId })
          .all(),
      ).toHaveLength(0);
      const rejectedPayment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: rejectOrderId })
        .first();
      expect(rejectedPayment?.amountMinor).toBe(
        rejectPaymentBefore?.amountMinor,
      );
      expect(rejectedPayment?.method).toBe('COD');
      const customerProfile = await prisma
        .getDb()
        .orm.public.CustomerProfile.where({ accountId: accountCustomer.id })
        .first();
      const carts = await prisma
        .getDb()
        .orm.public.Cart.where({ customerId: customerProfile!.id })
        .all();
      expect(carts.some((cart) => cart.status === 'CONVERTED')).toBe(true);
      expect(carts.some((cart) => cart.status === 'ACTIVE')).toBe(false);

      const electronicId = await createFollowOnOrder('ELECTRONIC');
      const electronicAccept = await request(server)
        .post(`/api/v1/merchant/${merchantId}/orders/${electronicId}/accept`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(electronicAccept.status).toBe(200);
      expect((electronicAccept.body as MerchantOrderDetail).status).toBe(
        'CONFIRMED',
      );
      const unpaidPrep = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${electronicId}/start-preparation`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(unpaidPrep.status).toBe(409);
      expect((unpaidPrep.body as ErrorBody).error.code).toBe(
        'MERCHANT_ORDER_PAYMENT_NOT_READY',
      );
      await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: electronicId })
        .update({
          status: 'SUCCEEDED',
          updatedAt: pgNow(),
        });
      const paidPrep = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${electronicId}/start-preparation`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(paidPrep.status).toBe(200);
      expect((paidPrep.body as MerchantOrderDetail).status).toBe('ACTIVE');
      expect((paidPrep.body as MerchantOrderDetail).fulfillmentStatus).toBe(
        'PREPARING',
      );

      const raceId = await createFollowOnOrder('COD');
      const [raceAccept, raceReject] = await Promise.all([
        request(server)
          .post(`/api/v1/merchant/${merchantId}/orders/${raceId}/accept`)
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({}),
        request(server)
          .post(`/api/v1/merchant/${merchantId}/orders/${raceId}/reject`)
          .set('Authorization', `Bearer ${tokenManager}`)
          .send({ reason: 'Cannot fulfill now' }),
      ]);
      const raceWinner = [raceAccept, raceReject].filter(
        (row) => row.status === 200,
      );
      const raceLoser = [raceAccept, raceReject].filter(
        (row) => row.status !== 200,
      );
      expect(raceWinner).toHaveLength(1);
      expect(raceLoser).toHaveLength(1);
      const raceOrder = await prisma
        .getDb()
        .orm.public.Order.where({ id: raceId })
        .first();
      const raceEvents = await prisma
        .getDb()
        .orm.public.OrderStatusEvent.where({ orderId: raceId })
        .all();
      const raceCancellation = await prisma
        .getDb()
        .orm.public.OrderCancellation.where({ orderId: raceId })
        .first();
      const racePayment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: raceId })
        .first();
      const acceptedWin = raceOrder?.status === 'CONFIRMED';
      const rejectedWin = raceOrder?.status === 'CANCELLED';
      expect(acceptedWin || rejectedWin).toBe(true);
      if (acceptedWin) {
        expect(raceOrder?.fulfillmentStatus).toBe('ACCEPTED');
        expect(racePayment?.status).toBe('PENDING');
        expect(raceCancellation).toBeNull();
        expect(
          raceEvents.filter((event) => event.eventType === 'MERCHANT_ACCEPTED'),
        ).toHaveLength(1);
        expect(
          raceEvents.filter((event) => event.eventType === 'MERCHANT_REJECTED'),
        ).toHaveLength(0);
      } else {
        expect(raceOrder?.fulfillmentStatus).toBe('PENDING_ACCEPTANCE');
        expect(racePayment?.status).toBe('CANCELLED');
        expect(raceCancellation).toBeTruthy();
        expect(
          raceEvents.filter((event) => event.eventType === 'MERCHANT_REJECTED'),
        ).toHaveLength(1);
        expect(
          raceEvents.filter((event) => event.eventType === 'MERCHANT_ACCEPTED'),
        ).toHaveLength(0);
      }

      await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantId })
        .update({
          status: pgVarchar<64>('SUSPENDED'),
          updatedAt: pgNow(),
        });
      const suspendedRead = await request(server)
        .get(`/api/v1/merchant/${merchantId}/orders/${orderId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(suspendedRead.status).toBe(200);
      const suspendedMutate = await request(server)
        .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/mark-ready`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(suspendedMutate.status).toBe(409);
      expect((suspendedMutate.body as ErrorBody).error.code).toBe(
        'MERCHANT_STATUS_RESTRICTED',
      );
    } finally {
      await cleanupByPhone(e164[0] ?? '');
      await cleanupCommission(adminIds, roleIds);
      await cleanupZones(zoneIds);
      await cleanupByPhone(e164[1] ?? '');
      await cleanupByPhone(e164[4] ?? '');
      await cleanupByPhone(e164[2] ?? '');
      await cleanupByPhone(e164[3] ?? '');
    }
  });
});
