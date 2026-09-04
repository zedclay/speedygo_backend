import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { deactivateAllDeliveryZones } from './helpers/sanitize-delivery-zones';
import { deactivateOpenGlobalCommissionDefaults } from './helpers/sanitize-commission-globals';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';
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
import { MatchingProcessor } from '../src/modules/matching/infrastructure/matching.processor';
import { PAYMENT_PROVIDER } from '../src/modules/payments/domain/payment.types';
import type { ChargilyHttpClient } from '../src/modules/payments/infrastructure/providers/chargily-http.client';
import {
  ChargilyPaymentProvider,
  signChargilyWebhook,
} from '../src/modules/payments/infrastructure/providers/chargily-payment.provider';

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
  status: string;
  amountMinor: number;
  checkoutUrl?: string | null;
  attemptId?: string;
};
type MerchantOrderDetail = {
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
const SECRET = 'chargily-e2e-secret-key';

class FakeChargilyHttp implements ChargilyHttpClient {
  readonly checkouts = new Map<string, Record<string, unknown>>();
  lastCreateBody: Record<string, unknown> | null = null;

  request(input: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
  }): Promise<{ status: number; json: unknown }> {
    if (input.method === 'POST' && input.path === '/checkouts') {
      const body = (input.body ?? {}) as Record<string, unknown>;
      this.lastCreateBody = body;
      const id = `chk_${this.checkouts.size + 1}`;
      const checkout = {
        id,
        amount: body.amount,
        currency: body.currency,
        status: 'pending',
        checkout_url: `https://pay.chargily.net/test/checkouts/${id}/pay`,
        fees: 90,
        fees_on_merchant: 90,
        fees_on_customer: 0,
        metadata: body.metadata,
      };
      this.checkouts.set(id, checkout);
      return Promise.resolve({ status: 200, json: checkout });
    }
    if (input.method === 'GET' && input.path.startsWith('/checkouts/')) {
      const id = decodeURIComponent(input.path.slice('/checkouts/'.length));
      const checkout = this.checkouts.get(id);
      if (!checkout) {
        return Promise.resolve({ status: 404, json: null });
      }
      return Promise.resolve({ status: 200, json: checkout });
    }
    return Promise.resolve({ status: 500, json: null });
  }

  setStatus(id: string, status: string): void {
    const checkout = this.checkouts.get(id);
    if (checkout) {
      checkout.status = status;
    }
  }
}

function chargilyEvent(
  type: string,
  checkout: Record<string, unknown>,
  eventId: string,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      id: eventId,
      type,
      data: checkout,
    }),
  );
}

describe('Payments Chargily Pay V2 adapter (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let fakeHttp: FakeChargilyHttp;

  beforeAll(async () => {
    fakeHttp = new FakeChargilyHttp();
    const chargily = new ChargilyPaymentProvider(fakeHttp, {
      secretKey: SECRET,
      returnUrl: 'https://app.example/return',
      cancelUrl: 'https://app.example/cancel',
      webhookUrl: 'https://api.example/api/v1/payments/webhooks/chargily',
      locale: 'ar',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(chargily)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
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
        deviceName: 'chargily-e2e',
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
    await deleteAccountNotificationArtifacts(prisma, account.id);

    await prisma.getDb().orm.public.Account.where({ id: account.id }).delete();
  }

  it('drives Chargily V2 checkout, webhook, reuse, and late success against a mock transport', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0581${suffix}`,
      owner: `0582${suffix}`,
      other: `0583${suffix}`,
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
        .send({ fullName: 'Chargily Customer' });
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
      const homeId = (home.body as AddressBody).id;
      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Chargily Cafe' });
      const merchantId = (merchant.body as MembershipBody).merchantId;
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
      expect(branch.status).toBe(201);
      const branchId = (branch.body as BranchBody).id;
      await approveMerchant(merchantId);

      const now = pgNow();
      const category = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ branchId, name: 'Food' });
      expect(category.status).toBe(201);
      const product = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          branchId,
          categoryId: (category.body as CategoryBody).id,
          name: 'Pizza',
          priceMinor: 1000,
        });
      expect(product.status).toBe(201);
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
      expect(group.status).toBe(201);
      const large = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups/${(group.body as OptionGroupBody).id}/options`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Large', additionalPriceMinor: 200 });
      expect(large.status).toBe(201);
      const largeId = (large.body as OptionBody).id;
      const zoneId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Chargily zone ${suffix}`),
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
        name: pgVarchar<128>(`chargily-e2e-${suffix}`),
        description: null,
        active: true,
      });
      roleIds.push(roleId);
      const adminId = createUuidV7();
      await prisma.getDb().orm.public.AdminProfile.create({
        id: adminId,
        accountId: accountOwner.id,
        roleId,
        displayName: pgVarchar<255>('Chargily E2E Admin'),
        twoFactorEnabled: false,
        createdAt: now,
        updatedAt: now,
      });
      adminIds.push(adminId);
      await deactivateOpenGlobalCommissionDefaults(prisma);
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
      const initiated = await request(server)
        .post(`/api/v1/customer/orders/${electronic.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(initiated.status).toBe(200);
      const attempt = initiated.body as PaymentBody;
      expect(attempt.status).toBe('PROCESSING');
      expect(attempt.checkoutUrl).toMatch(
        /^https:\/\/pay\.chargily\.net\/test\/checkouts\/chk_/,
      );
      expect(fakeHttp.lastCreateBody).toMatchObject({
        amount: electronic.amountMinor,
        currency: 'dzd',
        chargily_pay_fees_allocation: 'merchant',
      });
      expect(fakeHttp.lastCreateBody).not.toHaveProperty('idempotency_key');
      expect(fakeHttp.checkouts.size).toBe(1);

      const reused = await request(server)
        .post(`/api/v1/customer/orders/${electronic.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect((reused.body as PaymentBody).attemptId).toBe(attempt.attemptId);
      expect(fakeHttp.checkouts.size).toBe(1);

      const paymentRow = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: electronic.orderId })
        .first();
      const initiatedTx = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({ paymentId: paymentRow!.id })
        .all();
      const checkoutId = initiatedTx[0].providerReference as string;
      const checkout = fakeHttp.checkouts.get(checkoutId)!;

      await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${electronic.orderId}/accept`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      const unpaidPrep = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${electronic.orderId}/start-preparation`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(unpaidPrep.status).toBe(409);

      const invalidRaw = chargilyEvent('checkout.paid', checkout, 'evt-bad');
      const invalidWebhook = await request(server)
        .post('/api/v1/payments/webhooks/chargily')
        .set('Content-Type', 'application/json')
        .set('signature', 'deadbeef')
        .send(invalidRaw.toString('utf8'));
      expect(invalidWebhook.status).toBe(401);

      fakeHttp.setStatus(checkoutId, 'paid');
      const paidCheckout = fakeHttp.checkouts.get(checkoutId)!;
      const successRaw = chargilyEvent(
        'checkout.paid',
        paidCheckout,
        'evt-chargily-paid',
      );
      const successWebhook = await request(server)
        .post('/api/v1/payments/webhooks/chargily')
        .set('Content-Type', 'application/json')
        .set('signature', signChargilyWebhook(SECRET, successRaw))
        .send(successRaw.toString('utf8'));
      expect(successWebhook.status).toBe(200);
      const duplicateWebhook = await request(server)
        .post('/api/v1/payments/webhooks/chargily')
        .set('Content-Type', 'application/json')
        .set('signature', signChargilyWebhook(SECRET, successRaw))
        .send(successRaw.toString('utf8'));
      expect(duplicateWebhook.status).toBe(200);
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Payment.where({ id: paymentRow!.id })
            .first()
        )?.status,
      ).toBe('SUCCEEDED');
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Order.where({ id: electronic.orderId })
            .first()
        )?.fulfillmentStatus,
      ).toBe('ACCEPTED');

      fakeHttp.setStatus(checkoutId, 'failed');
      const failedRaw = chargilyEvent(
        'checkout.failed',
        fakeHttp.checkouts.get(checkoutId)!,
        'evt-chargily-failed-late',
      );
      const lateFail = await request(server)
        .post('/api/v1/payments/webhooks/chargily')
        .set('Content-Type', 'application/json')
        .set('signature', signChargilyWebhook(SECRET, failedRaw))
        .send(failedRaw.toString('utf8'));
      expect(lateFail.status).toBe(200);
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Payment.where({ id: paymentRow!.id })
            .first()
        )?.status,
      ).toBe('SUCCEEDED');

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

      const recon = await addCartAndCreateOrder('ELECTRONIC');
      const reconInit = await request(server)
        .post(`/api/v1/customer/orders/${recon.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(reconInit.status).toBe(200);
      const reconPayment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: recon.orderId })
        .first();
      const reconTx = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({ paymentId: reconPayment!.id })
        .all();
      const reconRef = reconTx[0].providerReference as string;
      const checkoutsBefore = fakeHttp.checkouts.size;
      fakeHttp.setStatus(reconRef, 'paid');
      const reconRetry = await request(server)
        .post(`/api/v1/customer/orders/${recon.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect((reconRetry.body as PaymentBody).status).toBe('SUCCEEDED');
      expect(fakeHttp.checkouts.size).toBe(checkoutsBefore);

      const canceled = await addCartAndCreateOrder('ELECTRONIC');
      const canceledInit = await request(server)
        .post(`/api/v1/customer/orders/${canceled.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      const canceledPayment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: canceled.orderId })
        .first();
      const canceledTx = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({
          paymentId: canceledPayment!.id,
        })
        .all();
      fakeHttp.setStatus(canceledTx[0].providerReference as string, 'canceled');
      const canceledRetry = await request(server)
        .post(`/api/v1/customer/orders/${canceled.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(canceledRetry.status).toBe(200);
      expect((canceledRetry.body as PaymentBody).attemptId).not.toBe(
        (canceledInit.body as PaymentBody).attemptId,
      );
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Order.where({ id: canceled.orderId })
            .first()
        )?.status,
      ).toBe('CREATED');

      const failed = await addCartAndCreateOrder('ELECTRONIC');
      const failedInit = await request(server)
        .post(`/api/v1/customer/orders/${failed.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      const failedPayment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: failed.orderId })
        .first();
      const failedTx = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({ paymentId: failedPayment!.id })
        .all();
      fakeHttp.setStatus(failedTx[0].providerReference as string, 'failed');
      const failedRetry = await request(server)
        .post(`/api/v1/customer/orders/${failed.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect((failedRetry.body as PaymentBody).attemptId).not.toBe(
        (failedInit.body as PaymentBody).attemptId,
      );

      const late = await addCartAndCreateOrder('ELECTRONIC');
      await request(server)
        .post(`/api/v1/customer/orders/${late.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      const latePayment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: late.orderId })
        .first();
      const lateTx = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({ paymentId: latePayment!.id })
        .all();
      const lateRef = lateTx[0].providerReference as string;
      await prisma
        .getDb()
        .orm.public.Order.where({ id: late.orderId })
        .update({ status: 'CANCELLED', updatedAt: pgNow() });
      fakeHttp.setStatus(lateRef, 'paid');
      const lateRaw = chargilyEvent(
        'checkout.paid',
        fakeHttp.checkouts.get(lateRef)!,
        'evt-late-chargily',
      );
      const lateWebhook = await request(server)
        .post('/api/v1/payments/webhooks/chargily')
        .set('Content-Type', 'application/json')
        .set('signature', signChargilyWebhook(SECRET, lateRaw))
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

      const cod = await addCartAndCreateOrder('COD');
      const codInitiate = await request(server)
        .post(`/api/v1/customer/orders/${cod.orderId}/payment/initiate`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(codInitiate.status).toBe(409);
      expect((codInitiate.body as ErrorBody).error.code).toBe(
        'PAYMENT_METHOD_NOT_ELECTRONIC',
      );
    } finally {
      await cleanupByPhone(e164[0] ?? '');
      await cleanupCommission(adminIds, roleIds);
      await cleanupZones(zoneIds);
      await cleanupByPhone(e164[1] ?? '');
      await cleanupByPhone(e164[2] ?? '');
    }
  });
});
