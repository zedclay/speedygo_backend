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
import { DeliveryService } from '../src/modules/delivery/application/delivery.service';

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
type DeliveryBody = {
  id: string;
  status: string;
  orderStatus: string;
  fulfillmentStatus: string;
  assignedDriverId: string | null;
  driverSearchStartedAt: string | null;
  pickup: {
    merchantBranchId: string;
    name: string;
    addressText: string;
    phone?: string;
  };
  dropoff: { addressText: string };
  events: Array<{ type: string; driverId: string | null }>;
  deliveryFeeMinor?: number;
};

const INSIDE: [number, number] = [36.75, 3.05];
const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

describe('Delivery foundation (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let deliveryService: DeliveryService;

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
    deliveryService = app.get(DeliveryService);
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
        deviceName: 'delivery-e2e',
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

  it('creates one Delivery after READY without Driver matching or assignment', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0591${suffix}`,
      owner: `0592${suffix}`,
      other: `0593${suffix}`,
      driver: `0596${suffix}`,
    };
    const e164: string[] = [];
    const zoneIds: string[] = [];
    const adminIds: string[] = [];
    const roleIds: string[] = [];
    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenOwner = await authenticate(phones.owner);
      const tokenOther = await authenticate(phones.other);
      const tokenDriver = await authenticate(phones.driver);
      const accountCustomer = await authMe(tokenCustomer);
      const accountOwner = await authMe(tokenOwner);
      e164.push(
        accountCustomer.phone,
        accountOwner.phone,
        (await authMe(tokenOther)).phone,
        (await authMe(tokenDriver)).phone,
      );

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'Delivery Customer' });
      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenOther}`)
        .send({ fullName: 'Other Delivery Customer' });
      const home = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          label: 'Home',
          addressText: 'Inside zone',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const homeId = (home.body as AddressBody).id;

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Delivery Cafe' });
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const otherMerchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOther}`)
        .send({ name: 'Other Delivery Cafe' });
      const otherMerchantId = (otherMerchant.body as MembershipBody).merchantId;
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'Main',
          phone: '0550123488',
          addressText: 'Street A',
          latitude: 36.75,
          longitude: 3.05,
        });
      const branchId = (branch.body as BranchBody).id;
      await approveMerchant(merchantId);
      await approveMerchant(otherMerchantId);

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
        name: pgVarchar<255>(`Delivery zone ${suffix}`),
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
        name: pgVarchar<128>(`delivery-e2e-${suffix}`),
        description: null,
        active: true,
      });
      roleIds.push(roleId);
      const adminId = createUuidV7();
      await prisma.getDb().orm.public.AdminProfile.create({
        id: adminId,
        accountId: accountOwner.id,
        roleId,
        displayName: pgVarchar<255>('Delivery E2E Admin'),
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

      async function addCartAndOrder(
        paymentMethod: 'COD' | 'ELECTRONIC',
      ): Promise<string> {
        await request(server)
          .post('/api/v1/customer/cart/items')
          .set('Authorization', `Bearer ${tokenCustomer}`)
          .send({ productId, quantity: 1, optionIds: [largeId] });
        const preview = await previewCheckout(tokenCustomer, homeId);
        const created = await request(server)
          .post('/api/v1/customer/orders')
          .set('Authorization', `Bearer ${tokenCustomer}`)
          .send({
            addressId: homeId,
            paymentMethod,
            expectedMerchandiseSubtotalMinor: preview.merchandiseSubtotalMinor,
            expectedDeliveryFeeMinor: preview.deliveryFeeMinor,
            expectedCustomerTotalMinor: preview.customerTotalMinor,
          });
        expect(created.status).toBe(201);
        return (created.body as { id: string }).id;
      }

      async function merchantReady(orderId: string): Promise<void> {
        const accepted = await request(server)
          .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/accept`)
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({});
        expect(accepted.status).toBe(200);
        const prepared = await request(server)
          .post(
            `/api/v1/merchant/${merchantId}/orders/${orderId}/start-preparation`,
          )
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({});
        expect(prepared.status).toBe(200);
        const ready = await request(server)
          .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/mark-ready`)
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({});
        expect(ready.status).toBe(200);
        expect((ready.body as { status: string }).status).toBe('ACTIVE');
        expect(
          (ready.body as { fulfillmentStatus: string }).fulfillmentStatus,
        ).toBe('READY');
      }

      const orderId = await addCartAndOrder('COD');
      await merchantReady(orderId);

      const missing = await request(server)
        .get(`/api/v1/customer/orders/${orderId}/delivery`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(missing.status).toBe(404);
      expect((missing.body as ErrorBody).error.code).toBe('DELIVERY_NOT_FOUND');

      await request(server)
        .patch(`/api/v1/customer/addresses/${homeId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ addressText: 'Moved after Order' });
      await request(server)
        .patch(`/api/v1/merchant/${merchantId}/branches/${branchId}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ addressText: 'Live pickup street' });

      const [first, second] = await Promise.all([
        deliveryService.createForReadyOrder(orderId),
        deliveryService.createForReadyOrder(orderId),
      ]);
      expect(first.id).toBe(second.id);
      expect(first.status).toBe('SEARCHING_DRIVER');
      expect(first.driverSearchStartedAt).toBeTruthy();
      expect(first.assignedDriverId).toBeNull();
      expect(first.orderStatus).toBe('ACTIVE');
      expect(first.fulfillmentStatus).toBe('READY');
      expect(first.dropoff.addressText).toBe('Inside zone');
      expect(first.pickup.addressText).toBe('Live pickup street');
      expect(
        first.events.filter((event) => event.type === 'DELIVERY_CREATED'),
      ).toHaveLength(1);

      const retry = await deliveryService.createForReadyOrder(orderId);
      expect(retry.id).toBe(first.id);
      expect(retry.driverSearchStartedAt).toBe(first.driverSearchStartedAt);
      expect(retry.status).toBe('SEARCHING_DRIVER');

      const rows = await prisma
        .getDb()
        .orm.public.Delivery.where({ orderId })
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('SEARCHING_DRIVER');
      expect(rows[0].driverSearchStartedAt).toBe(first.driverSearchStartedAt);
      const events = await prisma
        .getDb()
        .orm.public.DeliveryEvent.where({ deliveryId: first.id })
        .all();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('DELIVERY_CREATED');
      expect(events[0].driverId).toBeNull();
      expect(
        await prisma
          .getDb()
          .orm.public.DriverAssignment.where({ deliveryId: first.id })
          .all(),
      ).toHaveLength(0);
      expect(
        await prisma
          .getDb()
          .orm.public.DriverEarning.where({ deliveryId: first.id })
          .all(),
      ).toHaveLength(0);
      expect(
        await prisma.getDb().orm.public.CodCollection.where({ orderId }).all(),
      ).toHaveLength(0);
      const payment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId })
        .first();
      expect(payment?.method).toBe('COD');
      expect(payment?.status).toBe('PENDING');
      expect(
        await prisma
          .getDb()
          .orm.public.PaymentTransaction.where({ paymentId: payment!.id })
          .all(),
      ).toHaveLength(0);

      const financial = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({ orderId })
        .first();
      expect(Number(financial?.customerDeliveryFeeMinor)).toBe(500);
      expect(Number(financial?.driverRemunerationMinor)).toBe(300);
      const orderRow = await prisma
        .getDb()
        .orm.public.Order.where({ id: orderId })
        .first();
      expect(orderRow?.status).toBe('ACTIVE');
      expect(orderRow?.fulfillmentStatus).toBe('READY');

      const customerRead = await request(server)
        .get(`/api/v1/customer/orders/${orderId}/delivery`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(customerRead.status).toBe(200);
      const customerBody = customerRead.body as DeliveryBody;
      expect(customerBody.status).toBe('SEARCHING_DRIVER');
      expect(customerBody.assignedDriverId).toBeNull();
      expect(customerBody.driverSearchStartedAt).toBe(
        first.driverSearchStartedAt,
      );
      expect(customerBody.pickup).not.toHaveProperty('phone');
      expect(customerBody).not.toHaveProperty('driverRemunerationMinor');
      expect(customerBody.deliveryFeeMinor).toBe(500);

      const merchantRead = await request(server)
        .get(`/api/v1/merchant/${merchantId}/orders/${orderId}/delivery`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(merchantRead.status).toBe(200);
      const merchantBody = merchantRead.body as DeliveryBody;
      expect(merchantBody.status).toBe('SEARCHING_DRIVER');
      expect(merchantBody.assignedDriverId).toBeNull();
      expect(merchantBody.pickup.phone).toBe('+213550123488');
      expect(merchantBody).not.toHaveProperty('deliveryFeeMinor');
      expect(merchantBody).not.toHaveProperty('driverRemunerationMinor');

      await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantId })
        .update({
          status: pgVarchar<64>('SUSPENDED'),
          updatedAt: pgNow(),
        });
      const suspendedRead = await request(server)
        .get(`/api/v1/merchant/${merchantId}/orders/${orderId}/delivery`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(suspendedRead.status).toBe(200);
      expect((suspendedRead.body as DeliveryBody).status).toBe(
        'SEARCHING_DRIVER',
      );
      await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantId })
        .update({
          status: pgVarchar<64>('ACTIVE'),
          updatedAt: pgNow(),
        });

      const foreignCustomer = await request(server)
        .get(`/api/v1/customer/orders/${orderId}/delivery`)
        .set('Authorization', `Bearer ${tokenOther}`);
      expect(foreignCustomer.status).toBe(404);
      expect((foreignCustomer.body as ErrorBody).error.code).toBe(
        'ORDER_NOT_FOUND',
      );
      const foreignMerchant = await request(server)
        .get(`/api/v1/merchant/${otherMerchantId}/orders/${orderId}/delivery`)
        .set('Authorization', `Bearer ${tokenOther}`);
      expect(foreignMerchant.status).toBe(404);
      expect((foreignMerchant.body as ErrorBody).error.code).toBe(
        'MERCHANT_ORDER_NOT_FOUND',
      );

      const driverBrowse = await request(server)
        .get('/api/v1/driver/deliveries')
        .set('Authorization', `Bearer ${tokenDriver}`);
      expect(driverBrowse.status).toBe(404);
      const driverCustomerLeak = await request(server)
        .get(`/api/v1/customer/orders/${orderId}/delivery`)
        .set('Authorization', `Bearer ${tokenDriver}`);
      expect(driverCustomerLeak.status).toBe(404);
      const driverMerchantLeak = await request(server)
        .get(`/api/v1/merchant/${merchantId}/orders/${orderId}/delivery`)
        .set('Authorization', `Bearer ${tokenDriver}`);
      expect(driverMerchantLeak.status).toBe(404);

      const electronicId = await addCartAndOrder('ELECTRONIC');
      const electronicAccept = await request(server)
        .post(`/api/v1/merchant/${merchantId}/orders/${electronicId}/accept`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(electronicAccept.status).toBe(200);
      await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: electronicId })
        .update({ status: 'SUCCEEDED', updatedAt: pgNow() });
      await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${electronicId}/start-preparation`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${electronicId}/mark-ready`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: electronicId })
        .update({ status: 'PENDING', updatedAt: pgNow() });
      await expect(
        deliveryService.createForReadyOrder(electronicId),
      ).rejects.toMatchObject({ code: 'DELIVERY_PAYMENT_NOT_READY' });
      await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: electronicId })
        .update({ status: 'SUCCEEDED', updatedAt: pgNow() });
      const electronicDelivery =
        await deliveryService.createForReadyOrder(electronicId);
      expect(electronicDelivery.status).toBe('SEARCHING_DRIVER');
      expect(electronicDelivery.driverSearchStartedAt).toBeTruthy();
      expect(electronicDelivery.assignedDriverId).toBeNull();
    } finally {
      await cleanupByPhone(e164[0] ?? '');
      await cleanupCommission(adminIds, roleIds);
      await cleanupZones(zoneIds);
      await cleanupByPhone(e164[1] ?? '');
      await cleanupByPhone(e164[2] ?? '');
      await cleanupByPhone(e164[3] ?? '');
    }
  });
});
