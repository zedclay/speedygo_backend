import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
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
import { DeliveryService } from '../src/modules/delivery/application/delivery.service';
import { DELIVERY_ERROR_CODES } from '../src/modules/delivery/domain/delivery.errors';
import { MatchingProcessor } from '../src/modules/matching/infrastructure/matching.processor';
import { PAYMENT_PROVIDER } from '../src/modules/payments/domain/payment.types';
import { TestPaymentProvider } from '../src/modules/payments/infrastructure/providers/test-payment.provider';

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
type PaymentBody = {
  paymentId: string;
  method: string;
  status: string;
  amountMinor: number;
  currency: string;
  provider: string | null;
  checkoutUrl?: string | null;
  attemptId?: string;
};
type MerchantOrderDetail = {
  status: string;
  fulfillmentStatus: string;
  payment: { method: string; status: string };
};

const INSIDE: [number, number] = [36.75, 3.05];
const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];
const TEST_WEBHOOK_SECRET = 'test-payment-webhook-secret';

function sign(raw: Buffer): string {
  return `sha256=${createHmac('sha256', TEST_WEBHOOK_SECRET).update(raw).digest('hex')}`;
}

describe('Payments foundation (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let deliveryService: DeliveryService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    sender = app.get(OTP_SENDER);
    prisma = app.get(PrismaService);
    await deactivateAllDeliveryZones(prisma);
    redis = app.get(RedisService);
    deliveryService = app.get(DeliveryService);
    const leftover = await redis.getClient().keys('auth:test:*');
    if (leftover.length > 0) {
      await redis.getClient().del(...leftover);
    }
  });

  afterAll(async () => {
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
        deviceName: 'payments-e2e',
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

  it('executes ELECTRONIC payment, keeps COD pending, and integrates Merchant/Delivery gates', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0591${suffix}`,
      owner: `0592${suffix}`,
      other: `0593${suffix}`,
    };
    const e164: string[] = [];
    const zoneIds: string[] = [];
    const adminIds: string[] = [];
    const roleIds: string[] = [];
    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenOwner = await authenticate(phones.owner);
      const tokenOther = await authenticate(phones.other);
      const accountCustomer = await authMe(tokenCustomer);
      const accountOwner = await authMe(tokenOwner);
      const accountOther = await authMe(tokenOther);
      e164.push(accountCustomer.phone, accountOwner.phone, accountOther.phone);

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'Pay Customer' });
      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenOther}`)
        .send({ fullName: 'Other Customer' });
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
        .send({ name: 'Pay Cafe' });
      expect(merchant.status).toBe(201);
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
      expect(branch.status).toBe(201);
      const branchId = (branch.body as BranchBody).id;
      await approveMerchant(merchantId);

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

      const zoneId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Pay zone ${suffix}`),
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
        name: pgVarchar<128>(`pay-e2e-${suffix}`),
        description: null,
        active: true,
      });
      roleIds.push(roleId);
      const adminId = createUuidV7();
      await prisma.getDb().orm.public.AdminProfile.create({
        id: adminId,
        accountId: accountOwner.id,
        roleId,
        displayName: pgVarchar<255>('Pay E2E Admin'),
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

      async function addCartAndCreateOrder(
        paymentMethod: 'COD' | 'ELECTRONIC',
      ): Promise<{ orderId: string; amountMinor: number }> {
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
        return {
          orderId: (created.body as { id: string }).id,
          amountMinor: preview.customerTotalMinor,
        };
      }

      const electronic = await addCartAndCreateOrder('ELECTRONIC');
      const paymentRead = await request(server)
        .get(`/api/v1/customer/orders/${electronic.orderId}/payment`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(paymentRead.status).toBe(200);
      const pending = paymentRead.body as PaymentBody;
      expect(pending.status).toBe('PENDING');
      expect(pending.method).toBe('ELECTRONIC');
      expect(pending.amountMinor).toBe(electronic.amountMinor);
      expect(pending.currency).toBe('DZD');
      expect(pending).not.toHaveProperty('checkoutUrl');
      expect(pending).not.toHaveProperty('merchantCommissionAmountMinor');

      const foreignRead = await request(server)
        .get(`/api/v1/customer/orders/${electronic.orderId}/payment`)
        .set('Authorization', `Bearer ${tokenOther}`);
      expect(foreignRead.status).toBe(404);
      expect((foreignRead.body as ErrorBody).error.code).toBe(
        'PAYMENT_NOT_FOUND',
      );

      const injected = await request(server)
        .post(`/api/v1/customer/orders/${electronic.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ amountMinor: 1, status: 'SUCCEEDED', providerReference: 'x' });
      expect(injected.status).toBe(400);

      const initiated = await request(server)
        .post(`/api/v1/customer/orders/${electronic.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(initiated.status).toBe(200);
      const attempt = initiated.body as PaymentBody;
      expect(attempt.status).toBe('PROCESSING');
      expect(attempt.attemptId).toBeDefined();
      expect(attempt.checkoutUrl).toMatch(/^test:\/\/checkout\//);
      expect(attempt.paymentId).not.toBe(attempt.attemptId);

      const reused = await request(server)
        .post(`/api/v1/customer/orders/${electronic.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(reused.status).toBe(200);
      expect((reused.body as PaymentBody).attemptId).toBe(attempt.attemptId);

      const foreignInitiate = await request(server)
        .post(`/api/v1/customer/orders/${electronic.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenOther}`)
        .send({});
      expect(foreignInitiate.status).toBe(404);

      const paymentRow = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: electronic.orderId })
        .first();
      const initiatedTx = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({ paymentId: paymentRow!.id })
        .all();
      expect(initiatedTx).toHaveLength(1);
      const providerReference = initiatedTx[0].providerReference as string;

      const accept = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${electronic.orderId}/accept`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(accept.status).toBe(200);
      const unpaidPrep = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${electronic.orderId}/start-preparation`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(unpaidPrep.status).toBe(409);
      expect((unpaidPrep.body as ErrorBody).error.code).toBe(
        'MERCHANT_ORDER_PAYMENT_NOT_READY',
      );

      const invalidRaw = Buffer.from(
        JSON.stringify({
          eventId: 'evt-invalid',
          providerReference,
          status: 'SUCCEEDED',
          amountMinor: electronic.amountMinor,
          currency: 'DZD',
        }),
      );
      const invalidWebhook = await request(server)
        .post('/api/v1/payments/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('X-SpeedyGo-Signature', 'sha256=deadbeef')
        .send(invalidRaw.toString('utf8'));
      expect(invalidWebhook.status).toBe(401);
      expect((invalidWebhook.body as ErrorBody).error.code).toBe(
        'PAYMENT_WEBHOOK_INVALID_SIGNATURE',
      );
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Payment.where({ id: paymentRow!.id })
            .first()
        )?.status,
      ).toBe('PROCESSING');

      const tamperRaw = Buffer.from(
        JSON.stringify({
          eventId: 'evt-tamper',
          providerReference,
          status: 'SUCCEEDED',
          amountMinor: 1,
          currency: 'DZD',
        }),
      );
      const tamperWebhook = await request(server)
        .post('/api/v1/payments/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('X-SpeedyGo-Signature', sign(tamperRaw))
        .send(tamperRaw.toString('utf8'));
      expect(tamperWebhook.status).toBe(200);
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Payment.where({ id: paymentRow!.id })
            .first()
        )?.status,
      ).toBe('PROCESSING');

      const successPayload = {
        eventId: 'evt-success',
        providerReference,
        status: 'SUCCEEDED',
        amountMinor: electronic.amountMinor,
        currency: 'DZD',
      };
      const successRaw = Buffer.from(JSON.stringify(successPayload));
      const successWebhook = await request(server)
        .post('/api/v1/payments/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('X-SpeedyGo-Signature', sign(successRaw))
        .send(successRaw.toString('utf8'));
      expect(successWebhook.status).toBe(200);

      const duplicateWebhook = await request(server)
        .post('/api/v1/payments/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('X-SpeedyGo-Signature', sign(successRaw))
        .send(successRaw.toString('utf8'));
      expect(duplicateWebhook.status).toBe(200);

      const paid = await prisma
        .getDb()
        .orm.public.Payment.where({ id: paymentRow!.id })
        .first();
      expect(paid?.status).toBe('SUCCEEDED');
      const orderAfterPay = await prisma
        .getDb()
        .orm.public.Order.where({ id: electronic.orderId })
        .first();
      expect(orderAfterPay?.status).toBe('CONFIRMED');
      expect(orderAfterPay?.fulfillmentStatus).toBe('ACCEPTED');
      expect(
        await prisma
          .getDb()
          .orm.public.Delivery.where({ orderId: electronic.orderId })
          .first(),
      ).toBeNull();
      expect(
        await prisma
          .getDb()
          .orm.public.Refund.where({ orderId: electronic.orderId })
          .all(),
      ).toHaveLength(0);
      expect(
        await prisma
          .getDb()
          .orm.public.CodCollection.where({ orderId: electronic.orderId })
          .all(),
      ).toHaveLength(0);
      expect(
        await prisma
          .getDb()
          .orm.public.MerchantSettlement.where({ merchantId })
          .all(),
      ).toHaveLength(0);
      const successTxs = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({ paymentId: paymentRow!.id })
        .all();
      expect(
        successTxs.filter(
          (row) => row.idempotencyKey === 'wh:test:evt-success',
        ),
      ).toHaveLength(1);

      const lateFailRaw = Buffer.from(
        JSON.stringify({
          eventId: 'evt-late-fail',
          providerReference,
          status: 'FAILED',
          amountMinor: electronic.amountMinor,
          currency: 'DZD',
        }),
      );
      const lateFailWebhook = await request(server)
        .post('/api/v1/payments/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('X-SpeedyGo-Signature', sign(lateFailRaw))
        .send(lateFailRaw.toString('utf8'));
      expect(lateFailWebhook.status).toBe(200);
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Payment.where({ id: paymentRow!.id })
            .first()
        )?.status,
      ).toBe('SUCCEEDED');

      const already = await request(server)
        .post(`/api/v1/customer/orders/${electronic.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(already.status).toBe(409);
      expect((already.body as ErrorBody).error.code).toBe(
        'PAYMENT_ALREADY_SUCCEEDED',
      );

      const paidPrep = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${electronic.orderId}/start-preparation`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(paidPrep.status).toBe(200);
      expect((paidPrep.body as MerchantOrderDetail).fulfillmentStatus).toBe(
        'PREPARING',
      );
      expect((paidPrep.body as MerchantOrderDetail).payment.status).toBe(
        'SUCCEEDED',
      );
      expect((paidPrep.body as MerchantOrderDetail).payment).not.toHaveProperty(
        'checkoutUrl',
      );

      const ready = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${electronic.orderId}/mark-ready`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(ready.status).toBe(200);
      const delivery = await deliveryService.createForReadyOrder(
        electronic.orderId,
      );
      expect(delivery.status).toBe('SEARCHING_DRIVER');

      const cod = await addCartAndCreateOrder('COD');
      const codRead = await request(server)
        .get(`/api/v1/customer/orders/${cod.orderId}/payment`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(codRead.status).toBe(200);
      expect((codRead.body as PaymentBody).status).toBe('PENDING');
      const codInitiate = await request(server)
        .post(`/api/v1/customer/orders/${cod.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(codInitiate.status).toBe(409);
      expect((codInitiate.body as ErrorBody).error.code).toBe(
        'PAYMENT_METHOD_NOT_ELECTRONIC',
      );
      const codPayment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: cod.orderId })
        .first();
      expect(codPayment?.status).toBe('PENDING');
      expect(
        await prisma
          .getDb()
          .orm.public.PaymentTransaction.where({ paymentId: codPayment!.id })
          .all(),
      ).toHaveLength(0);

      const testProvider = app.get<TestPaymentProvider>(PAYMENT_PROVIDER);

      const canceledOrder = await addCartAndCreateOrder('ELECTRONIC');
      const canceledInit = await request(server)
        .post(
          `/api/v1/customer/orders/${canceledOrder.orderId}/payment/initiate`,
        )
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(canceledInit.status).toBe(200);
      const canceledPayment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: canceledOrder.orderId })
        .first();
      const canceledTx = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({
          paymentId: canceledPayment!.id,
        })
        .all();
      testProvider.setCheckoutStatus(
        canceledTx[0].providerReference as string,
        'canceled',
      );
      const canceledRetry = await request(server)
        .post(
          `/api/v1/customer/orders/${canceledOrder.orderId}/payment/initiate`,
        )
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(canceledRetry.status).toBe(200);
      expect((canceledRetry.body as PaymentBody).attemptId).not.toBe(
        (canceledInit.body as PaymentBody).attemptId,
      );
      const canceledRows = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({
          paymentId: canceledPayment!.id,
        })
        .all();
      expect(canceledRows.some((row) => row.status === 'CANCELLED')).toBe(true);
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Order.where({ id: canceledOrder.orderId })
            .first()
        )?.status,
      ).toBe('CREATED');

      const failedOrder = await addCartAndCreateOrder('ELECTRONIC');
      const failedInit = await request(server)
        .post(`/api/v1/customer/orders/${failedOrder.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(failedInit.status).toBe(200);
      const failedPayment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: failedOrder.orderId })
        .first();
      const failedTx = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({ paymentId: failedPayment!.id })
        .all();
      testProvider.setCheckoutStatus(
        failedTx[0].providerReference as string,
        'failed',
      );
      const failedRetry = await request(server)
        .post(`/api/v1/customer/orders/${failedOrder.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(failedRetry.status).toBe(200);
      expect((failedRetry.body as PaymentBody).attemptId).not.toBe(
        (failedInit.body as PaymentBody).attemptId,
      );
      expect(
        (
          await prisma
            .getDb()
            .orm.public.PaymentTransaction.where({
              paymentId: failedPayment!.id,
            })
            .all()
        ).some((row) => row.status === 'FAILED'),
      ).toBe(true);

      const late = await addCartAndCreateOrder('ELECTRONIC');
      const lateInit = await request(server)
        .post(`/api/v1/customer/orders/${late.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(lateInit.status).toBe(200);
      const latePayment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: late.orderId })
        .first();
      const lateAttempt = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({ paymentId: latePayment!.id })
        .all();
      await prisma
        .getDb()
        .orm.public.Order.where({ id: late.orderId })
        .update({ status: 'CANCELLED', updatedAt: pgNow() });
      await prisma
        .getDb()
        .orm.public.Payment.where({ id: latePayment!.id })
        .update({ status: 'CANCELLED', updatedAt: pgNow() });
      const lateRaw = Buffer.from(
        JSON.stringify({
          eventId: 'evt-late-terminal',
          providerReference: lateAttempt[0].providerReference,
          status: 'SUCCEEDED',
          amountMinor: late.amountMinor,
          currency: 'DZD',
        }),
      );
      const lateWebhook = await request(server)
        .post('/api/v1/payments/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('X-SpeedyGo-Signature', sign(lateRaw))
        .send(lateRaw.toString('utf8'));
      expect(lateWebhook.status).toBe(200);
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Payment.where({ id: latePayment!.id })
            .first()
        )?.status,
      ).toBe('SUCCEEDED');
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Order.where({ id: late.orderId })
            .first()
        )?.status,
      ).toBe('CANCELLED');
      expect(
        await prisma
          .getDb()
          .orm.public.Delivery.where({ orderId: late.orderId })
          .first(),
      ).toBeNull();

      const pendingElectronic = await addCartAndCreateOrder('ELECTRONIC');
      await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${pendingElectronic.orderId}/accept`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      await prisma
        .getDb()
        .orm.public.Order.where({ id: pendingElectronic.orderId })
        .update({
          status: 'ACTIVE',
          fulfillmentStatus: 'READY',
          updatedAt: pgNow(),
        });
      await expect(
        deliveryService.createForReadyOrder(pendingElectronic.orderId),
      ).rejects.toMatchObject({
        code: DELIVERY_ERROR_CODES.DELIVERY_PAYMENT_NOT_READY,
      });
    } finally {
      await cleanupByPhone(e164[0] ?? '');
      await cleanupCommission(adminIds, roleIds);
      await cleanupZones(zoneIds);
      await cleanupByPhone(e164[1] ?? '');
      await cleanupByPhone(e164[2] ?? '');
    }
  });
});
