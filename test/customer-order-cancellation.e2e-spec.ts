import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
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

jest.setTimeout(120_000);

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
  merchandiseSubtotalMinor: string;
  deliveryFeeMinor: string;
  customerTotalMinor: string;
};
type CancelBody = {
  orderId: string;
  orderStatus: string;
  cancellationAccepted: boolean;
  refundRequired: boolean;
  refundId: string | null;
  refundStatus: string | null;
  refundAmountMinor: string | null;
  cancelledAt: string | null;
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

describe('Customer order cancellation (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;

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
        deviceName: 'cancel-e2e',
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
      for (const refund of await prisma
        .getDb()
        .orm.public.Refund.where({ orderId: order.id })
        .all()) {
        await prisma
          .getDb()
          .orm.public.Refund.where({ id: refund.id })
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
    await deleteAccountNotificationArtifacts(prisma, account.id);
    await prisma.getDb().orm.public.Account.where({ id: account.id }).delete();
  }

  async function postCancel(
    token: string,
    orderId: string,
    reason?: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send(reason === undefined ? {} : { reason });
  }

  async function payElectronicOrder(
    token: string,
    orderId: string,
    amountMinor: number,
    eventId = 'evt-paid',
  ): Promise<void> {
    const server = app.getHttpServer();
    const initiated = await request(server)
      .post(`/api/v1/customer/orders/${orderId}/payment/initiate`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(initiated.status).toBe(200);
    const paymentRow = await prisma
      .getDb()
      .orm.public.Payment.where({ orderId })
      .first();
    const initiatedTx = await prisma
      .getDb()
      .orm.public.PaymentTransaction.where({ paymentId: paymentRow!.id })
      .all();
    const providerReference = initiatedTx[0].providerReference as string;
    const successRaw = Buffer.from(
      JSON.stringify({
        eventId,
        providerReference,
        status: 'SUCCEEDED',
        amountMinor,
        currency: 'DZD',
      }),
    );
    const webhook = await request(server)
      .post('/api/v1/payments/webhooks/test')
      .set('Content-Type', 'application/json')
      .set('X-SpeedyGo-Signature', sign(successRaw))
      .send(successRaw.toString('utf8'));
    expect(webhook.status).toBe(200);
  }

  let tokenCustomer = '';
  let tokenOwner = '';
  let tokenOther = '';
  let tokenDriver = '';
  let merchantId = '';
  let homeId = '';
  let productId = '';
  let largeId = '';

  it('covers COD/unpaid/paid cancel, auth gates, idempotency, late success, and merchant paid reject coupling', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0594${suffix}`,
      owner: `0595${suffix}`,
      other: `0596${suffix}`,
      driver: `0597${suffix}`,
    };
    const e164: string[] = [];
    const zoneIds: string[] = [];
    const adminIds: string[] = [];
    const roleIds: string[] = [];
    try {
      tokenCustomer = await authenticate(phones.customer);
      tokenOwner = await authenticate(phones.owner);
      tokenOther = await authenticate(phones.other);
      tokenDriver = await authenticate(phones.driver);
      const accountCustomer = await authMe(tokenCustomer);
      const accountOwner = await authMe(tokenOwner);
      const accountOther = await authMe(tokenOther);
      e164.push(
        accountCustomer.phone,
        accountOwner.phone,
        accountOther.phone,
        (await authMe(tokenDriver)).phone,
      );

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'Cancel Customer' });
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
      homeId = (home.body as AddressBody).id;

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Cancel Cafe' });
      expect(merchant.status).toBe(201);
      merchantId = (merchant.body as MembershipBody).merchantId;
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
      productId = (product.body as ProductBody).id;
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
      largeId = (large.body as OptionBody).id;

      const zoneId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Cancel zone ${suffix}`),
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
        name: pgVarchar<128>(`cancel-e2e-${suffix}`),
        description: null,
        active: true,
      });
      roleIds.push(roleId);
      const adminId = createUuidV7();
      await prisma.getDb().orm.public.AdminProfile.create({
        id: adminId,
        accountId: accountOwner.id,
        roleId,
        displayName: pgVarchar<255>('Cancel E2E Admin'),
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
            expectedMerchandiseSubtotalMinor: Number(
              preview.merchandiseSubtotalMinor,
            ),
            expectedDeliveryFeeMinor: Number(preview.deliveryFeeMinor),
            expectedCustomerTotalMinor: Number(preview.customerTotalMinor),
          });
        expect(created.status).toBe(201);
        return {
          orderId: (created.body as { id: string }).id,
          amountMinor: Number(preview.customerTotalMinor),
        };
      }

      const cod = await addCartAndCreateOrder('COD');
      const codCancel = await postCancel(tokenCustomer, cod.orderId);
      expect(codCancel.status).toBe(200);
      const codBody = codCancel.body as CancelBody;
      expect(codBody.orderStatus).toBe('CANCELLED');
      expect(codBody.cancellationAccepted).toBe(true);
      expect(codBody.refundRequired).toBe(false);
      expect(codBody.refundId).toBeNull();
      expect(codBody.cancelledAt).not.toBeNull();
      expect(
        await prisma
          .getDb()
          .orm.public.Refund.where({ orderId: cod.orderId })
          .all(),
      ).toHaveLength(0);
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Payment.where({ orderId: cod.orderId })
            .first()
        )?.status,
      ).toBe('CANCELLED');

      const unpaidElectronic = await addCartAndCreateOrder('ELECTRONIC');
      const unpaidCancel = await postCancel(
        tokenCustomer,
        unpaidElectronic.orderId,
      );
      expect(unpaidCancel.status).toBe(200);
      const unpaidBody = unpaidCancel.body as CancelBody;
      expect(unpaidBody.refundRequired).toBe(false);
      expect(unpaidBody.refundId).toBeNull();
      expect(
        await prisma
          .getDb()
          .orm.public.Refund.where({ orderId: unpaidElectronic.orderId })
          .all(),
      ).toHaveLength(0);
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Payment.where({ orderId: unpaidElectronic.orderId })
            .first()
        )?.status,
      ).toBe('CANCELLED');

      const paidElectronic = await addCartAndCreateOrder('ELECTRONIC');
      await payElectronicOrder(
        tokenCustomer,
        paidElectronic.orderId,
        paidElectronic.amountMinor,
        'evt-cancel-paid',
      );
      const paidCancel = await postCancel(
        tokenCustomer,
        paidElectronic.orderId,
        'Changed my mind',
      );
      expect(paidCancel.status).toBe(200);
      const paidBody = paidCancel.body as CancelBody;
      expect(paidBody.orderStatus).toBe('CANCELLED');
      expect(paidBody.refundRequired).toBe(true);
      expect(paidBody.refundStatus).toBe('REQUESTED');
      expect(paidBody.refundAmountMinor).toBe(
        String(paidElectronic.amountMinor),
      );
      expect(typeof paidBody.refundAmountMinor).toBe('string');
      expect(paidBody.refundId).not.toBeNull();
      const paidRefunds = await prisma
        .getDb()
        .orm.public.Refund.where({ orderId: paidElectronic.orderId })
        .all();
      expect(paidRefunds).toHaveLength(1);
      expect(paidRefunds[0].status).toBe('REQUESTED');
      expect(paidRefunds[0].completedAt).toBeNull();
      expect(paidRefunds[0].refundMethod).toBe('MANUAL_OTHER');
      expect(paidRefunds[0].requestOrigin).toBe('CUSTOMER_CANCELLATION');
      expect(paidRefunds[0].requestedByAdminId).toBeNull();
      expect(paidRefunds[0].paidTerminalIntentKey).toMatch(
        /^paid-terminal:v1:/,
      );
      expect(JSON.stringify(paidBody)).not.toContain('paidTerminalIntentKey');
      expect(JSON.stringify(paidBody)).not.toContain('requestedByAdminId');
      expect(JSON.stringify(paidBody)).not.toContain('requestOrigin');

      const foreignCancel = await postCancel(
        tokenOther,
        paidElectronic.orderId,
      );
      expect(foreignCancel.status).toBe(404);
      expect((foreignCancel.body as ErrorBody).error.code).toBe(
        'ORDER_NOT_FOUND',
      );

      const merchantCancel = await postCancel(
        tokenOwner,
        paidElectronic.orderId,
      );
      expect(merchantCancel.status).toBe(404);
      expect((merchantCancel.body as ErrorBody).error.code).toBe(
        'CUSTOMER_PROFILE_NOT_FOUND',
      );

      const driverCancel = await postCancel(
        tokenDriver,
        paidElectronic.orderId,
      );
      expect(driverCancel.status).toBe(404);
      expect((driverCancel.body as ErrorBody).error.code).toBe(
        'CUSTOMER_PROFILE_NOT_FOUND',
      );

      const repeatCancel = await postCancel(
        tokenCustomer,
        paidElectronic.orderId,
      );
      expect(repeatCancel.status).toBe(200);
      const repeatBody = repeatCancel.body as CancelBody;
      expect(repeatBody.refundId).toBe(paidBody.refundId);
      expect(
        await prisma
          .getDb()
          .orm.public.Refund.where({ orderId: paidElectronic.orderId })
          .all(),
      ).toHaveLength(1);

      const acceptedOrder = await addCartAndCreateOrder('COD');
      const accept = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${acceptedOrder.orderId}/accept`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(accept.status).toBe(200);
      const afterAcceptCancel = await postCancel(
        tokenCustomer,
        acceptedOrder.orderId,
      );
      expect(afterAcceptCancel.status).toBe(409);
      expect((afterAcceptCancel.body as ErrorBody).error.code).toBe(
        'ORDER_CANCELLATION_NOT_ALLOWED',
      );

      const concurrentOrder = await addCartAndCreateOrder('ELECTRONIC');
      await payElectronicOrder(
        tokenCustomer,
        concurrentOrder.orderId,
        concurrentOrder.amountMinor,
        'evt-concurrent',
      );
      const [concurrentA, concurrentB] = await Promise.all([
        postCancel(tokenCustomer, concurrentOrder.orderId),
        postCancel(tokenCustomer, concurrentOrder.orderId),
      ]);
      expect(concurrentA.status).toBe(200);
      expect(concurrentB.status).toBe(200);
      const concurrentRefundIdA = (concurrentA.body as CancelBody).refundId;
      const concurrentRefundIdB = (concurrentB.body as CancelBody).refundId;
      expect(concurrentRefundIdA).toBe(concurrentRefundIdB);
      expect(
        await prisma
          .getDb()
          .orm.public.Refund.where({ orderId: concurrentOrder.orderId })
          .all(),
      ).toHaveLength(1);

      const lateCancelOrder = await addCartAndCreateOrder('ELECTRONIC');
      const lateInit = await request(server)
        .post(
          `/api/v1/customer/orders/${lateCancelOrder.orderId}/payment/initiate`,
        )
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({});
      expect(lateInit.status).toBe(200);
      const lateCancel = await postCancel(
        tokenCustomer,
        lateCancelOrder.orderId,
      );
      expect(lateCancel.status).toBe(200);
      expect((lateCancel.body as CancelBody).refundRequired).toBe(false);
      const latePayment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: lateCancelOrder.orderId })
        .first();
      const lateTx = await prisma
        .getDb()
        .orm.public.PaymentTransaction.where({ paymentId: latePayment!.id })
        .all();
      expect(latePayment?.status).toBe('PROCESSING');
      const lateOrderRow = await prisma
        .getDb()
        .orm.public.Order.where({ id: lateCancelOrder.orderId })
        .first();
      expect(lateOrderRow?.status).toBe('CANCELLED');

      const lateSuccessRaw = Buffer.from(
        JSON.stringify({
          eventId: 'evt-late-after-cancel',
          providerReference: lateTx[0].providerReference,
          status: 'SUCCEEDED',
          amountMinor: lateCancelOrder.amountMinor,
          currency: 'DZD',
        }),
      );
      const lateWebhook = await request(server)
        .post('/api/v1/payments/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('X-SpeedyGo-Signature', sign(lateSuccessRaw))
        .send(lateSuccessRaw.toString('utf8'));
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
            .orm.public.Order.where({ id: lateCancelOrder.orderId })
            .first()
        )?.status,
      ).toBe('CANCELLED');
      const lateRefunds = await prisma
        .getDb()
        .orm.public.Refund.where({ orderId: lateCancelOrder.orderId })
        .all();
      expect(lateRefunds).toHaveLength(1);
      expect(lateRefunds[0].status).toBe('REQUESTED');
      expect(lateRefunds[0].completedAt).toBeNull();
      expect(lateRefunds[0].requestOrigin).toBe('LATE_PAYMENT_SUCCESS');
      expect(lateRefunds[0].requestedByAdminId).toBeNull();
      expect(lateRefunds[0].paidTerminalIntentKey).toMatch(
        /^paid-terminal:v1:/,
      );

      const lateReplay = await request(server)
        .post('/api/v1/payments/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('X-SpeedyGo-Signature', sign(lateSuccessRaw))
        .send(lateSuccessRaw.toString('utf8'));
      expect(lateReplay.status).toBe(200);
      expect(
        await prisma
          .getDb()
          .orm.public.Refund.where({ orderId: lateCancelOrder.orderId })
          .all(),
      ).toHaveLength(1);

      const merchantRejectOrder = await addCartAndCreateOrder('ELECTRONIC');
      await prisma
        .getDb()
        .orm.public.Payment.where({ orderId: merchantRejectOrder.orderId })
        .update({
          status: 'SUCCEEDED',
          updatedAt: pgNow(),
        });
      const merchantReject = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${merchantRejectOrder.orderId}/reject`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ reason: 'Cannot fulfill paid order' });
      expect(merchantReject.status).toBe(200);
      const rejectRefunds = await prisma
        .getDb()
        .orm.public.Refund.where({ orderId: merchantRejectOrder.orderId })
        .all();
      expect(rejectRefunds).toHaveLength(1);
      expect(rejectRefunds[0].status).toBe('REQUESTED');
      expect(rejectRefunds[0].completedAt).toBeNull();
      expect(rejectRefunds[0].requestOrigin).toBe('MERCHANT_REJECTION');
      expect(rejectRefunds[0].requestedByAdminId).toBeNull();
      expect(rejectRefunds[0].paidTerminalIntentKey).toMatch(
        /^paid-terminal:v1:/,
      );
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
