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
import { PromotionService } from '../src/modules/promotions/application/promotion.service';
import {
  PROMOTION_TYPE_MERCHANT_RATE_BPS,
  PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
} from '../src/modules/promotions/domain/promotion.types';
import { deactivateAllDeliveryZones } from './helpers/sanitize-delivery-zones';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';

type TokenBody = { accessToken: string };
type AuthMeBody = { account: { id: string; phone: string } };
type PreviewBody = {
  merchandiseSubtotalMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  promoCode: string | null;
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

describe('Promotions Foundation (e2e)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let promotions: PromotionService;

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
    promotions = app.get(PromotionService);
    for (const pattern of ['auth:test:*']) {
      const keys = await redis.getClient().keys(pattern);
      if (keys.length > 0) {
        await redis.getClient().del(...keys);
      }
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
        deviceName: 'promo-e2e',
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

  type Fixture = {
    customerToken: string;
    ownerToken: string;
    merchantId: string;
    productId: string;
    addressId: string;
    phones: string[];
    zoneId: string;
    adminId: string;
    roleId: string;
    promoIds: string[];
    deliveryFeeMinor: number;
  };

  async function cleanupByPhone(phoneE164: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    const account = await db.Account.where({ phone: phoneE164 }).first();
    if (!account) return;
    const customer = await db.CustomerProfile.where({
      accountId: account.id,
    }).first();
    if (customer) {
      for (const order of await db.Order.where({
        customerId: customer.id,
      }).all()) {
        for (const red of await db.PromotionRedemption.where({
          orderId: order.id,
        }).all()) {
          await db.PromotionRedemption.where({ id: red.id }).delete();
        }
        for (const entry of await db.FinancialLedgerEntry.where({
          orderId: order.id,
        }).all()) {
          await db.FinancialLedgerEntry.where({ id: entry.id }).delete();
        }
        for (const payment of await db.Payment.where({
          orderId: order.id,
        }).all()) {
          for (const tx of await db.PaymentTransaction.where({
            paymentId: payment.id,
          }).all()) {
            await db.PaymentTransaction.where({ id: tx.id }).delete();
          }
          await db.Payment.where({ id: payment.id }).delete();
        }
        await db.OrderFinancialSnapshot.where({ orderId: order.id }).delete();
        for (const item of await db.OrderItem.where({
          orderId: order.id,
        }).all()) {
          for (const opt of await db.OrderItemOption.where({
            orderItemId: item.id,
          }).all()) {
            await db.OrderItemOption.where({ id: opt.id }).delete();
          }
          await db.OrderItem.where({ id: item.id }).delete();
        }
        await db.OrderDeliveryAddressSnapshot.where({
          orderId: order.id,
        }).delete();
        for (const ev of await db.OrderStatusEvent.where({
          orderId: order.id,
        }).all()) {
          await db.OrderStatusEvent.where({ id: ev.id }).delete();
        }
        await db.Order.where({ id: order.id }).delete();
      }
      for (const cart of await db.Cart.where({
        customerId: customer.id,
      }).all()) {
        for (const item of await db.CartItem.where({ cartId: cart.id }).all()) {
          for (const opt of await db.CartItemOption.where({
            cartItemId: item.id,
          }).all()) {
            await db.CartItemOption.where({ id: opt.id }).delete();
          }
          await db.CartItem.where({ id: item.id }).delete();
        }
        await db.Cart.where({ id: cart.id }).delete();
      }
      for (const addr of await db.Address.where({
        customerId: customer.id,
      }).all()) {
        await db.Address.where({ id: addr.id }).delete();
      }
      await db.CustomerProfile.where({ id: customer.id }).delete();
    }
    const memberships = await db.MerchantMember.where({
      accountId: account.id,
    }).all();
    for (const merchantId of [
      ...new Set(memberships.map((row) => row.merchantId)),
    ]) {
      for (const branch of await db.MerchantBranch.where({
        merchantId,
      }).all()) {
        for (const product of await db.Product.where({
          merchantBranchId: branch.id,
        }).all()) {
          for (const group of await db.ProductOptionGroup.where({
            productId: product.id,
          }).all()) {
            for (const opt of await db.ProductOption.where({
              optionGroupId: group.id,
            }).all()) {
              await db.ProductOption.where({ id: opt.id }).delete();
            }
            await db.ProductOptionGroup.where({ id: group.id }).delete();
          }
          await db.Product.where({ id: product.id }).delete();
        }
        for (const cat of await db.Category.where({
          merchantBranchId: branch.id,
        }).all()) {
          await db.Category.where({ id: cat.id }).delete();
        }
        await db.MerchantBranch.where({ id: branch.id }).delete();
      }
      for (const member of await db.MerchantMember.where({
        merchantId,
      }).all()) {
        await db.MerchantMember.where({ id: member.id }).delete();
      }
      await db.Merchant.where({ id: merchantId }).delete();
    }
    for (const session of await db.Session.where({
      accountId: account.id,
    }).all()) {
      await db.Session.where({ id: session.id }).delete();
    }
    for (const device of await db.Device.where({
      accountId: account.id,
    }).all()) {
      for (const token of await db.DeviceToken.where({
        deviceId: device.id,
      }).all()) {
        await db.DeviceToken.where({ id: token.id }).delete();
      }
      await db.Device.where({ id: device.id }).delete();
    }
    await deleteAccountNotificationArtifacts(prisma, account.id);

    await db.Account.where({ id: account.id }).delete();
  }

  async function createFixture(
    suffix: string,
    options: {
      deliveryFeeMinor?: number;
      driverRemunerationMinor?: number;
    } = {},
  ): Promise<Fixture> {
    await deactivateAllDeliveryZones(prisma);
    const deliveryFeeMinor = options.deliveryFeeMinor ?? 500;
    const driverRemunerationMinor = options.driverRemunerationMinor ?? 300;
    const server = app.getHttpServer();
    const phones = [`0581${suffix}`, `0582${suffix}`];
    const customerToken = await authenticate(phones[0]);
    const ownerToken = await authenticate(phones[1]);
    const accounts = await Promise.all([customerToken, ownerToken].map(authMe));

    await request(server)
      .post('/api/v1/customer/profile')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'Promo Customer' });
    const address = await request(server)
      .post('/api/v1/customer/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        label: 'Home',
        addressText: 'Promo dropoff',
        latitude: INSIDE[0],
        longitude: INSIDE[1],
      });
    expect(address.status).toBe(201);

    const merchant = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Promo Cafe ${suffix}` });
    const merchantId = (merchant.body as { merchantId: string }).merchantId;
    const branch = await request(server)
      .post(`/api/v1/merchant/${merchantId}/branches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Main',
        phone: `0551${suffix}`,
        addressText: 'Pickup',
        latitude: INSIDE[0],
        longitude: INSIDE[1],
      });
    const branchId = (branch.body as { id: string }).id;
    await prisma
      .getDb()
      .orm.public.Merchant.where({ id: merchantId })
      .update({
        status: pgVarchar<64>('ACTIVE'),
        verifiedAt: pgNow(),
        updatedAt: pgNow(),
      });
    const category = await request(server)
      .post(`/api/v1/merchant/${merchantId}/categories`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ branchId, name: 'Meals' });
    const product = await request(server)
      .post(`/api/v1/merchant/${merchantId}/products`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        branchId,
        categoryId: (category.body as { id: string }).id,
        name: 'Promo meal',
        priceMinor: 10000,
      });

    const now = pgNow();
    const zoneId = createUuidV7();
    await prisma.getDb().orm.public.DeliveryZone.create({
      id: zoneId,
      name: pgVarchar<255>(`Promo zone ${suffix}`),
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
      customerDeliveryFeeMinor: pgBigInt(deliveryFeeMinor),
      driverRemunerationMinor: pgBigInt(driverRemunerationMinor),
      effectiveFrom: pgTimestamptz('2020-01-01T00:00:00.000Z'),
      effectiveTo: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    const roleId = createUuidV7();
    await prisma.getDb().orm.public.Role.create({
      id: roleId,
      name: pgVarchar<128>(`promo-e2e-${suffix}`),
      description: null,
      active: true,
    });
    const adminId = createUuidV7();
    await prisma.getDb().orm.public.AdminProfile.create({
      id: adminId,
      accountId: accounts[1].id,
      roleId,
      displayName: pgVarchar<255>('Promo Admin'),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await prisma.getDb().orm.public.MerchantCommissionRule.create({
      id: createUuidV7(),
      scope: 'MERCHANT_OVERRIDE',
      merchantId: merchantId,
      rateBps: 700,
      effectiveFrom: pgTimestamptz('2020-01-01T00:00:00.000Z'),
      effectiveTo: null,
      changeReason: null,
      changedByAdminId: adminId,
      active: true,
      createdAt: now,
    });

    return {
      customerToken,
      ownerToken,
      merchantId,
      productId: (product.body as { id: string }).id,
      addressId: (address.body as { id: string }).id,
      phones: accounts.map((a) => a.phone),
      zoneId,
      adminId,
      roleId,
      promoIds: [],
      deliveryFeeMinor,
    };
  }

  async function cleanupFixture(fixture: Fixture): Promise<void> {
    const db = prisma.getDb().orm.public;
    for (const promoId of fixture.promoIds) {
      for (const red of await db.PromotionRedemption.where({
        promotionId: promoId,
      }).all()) {
        await db.PromotionRedemption.where({ id: red.id }).delete();
      }
      await db.Promotion.where({ id: promoId }).delete();
    }
    // Customer phone first: drops Orders/OFS that FK commission rules.
    if (fixture.phones[0]) {
      await cleanupByPhone(fixture.phones[0]);
    }
    for (const rule of await db.MerchantCommissionRule.where({
      changedByAdminId: fixture.adminId,
    }).all()) {
      await db.MerchantCommissionRule.where({ id: rule.id }).delete();
    }
    await db.AdminProfile.where({ id: fixture.adminId }).delete();
    await db.Role.where({ id: fixture.roleId }).delete();
    for (const phone of fixture.phones.slice(1)) {
      await cleanupByPhone(phone);
    }
    for (const rule of await db.DeliveryPricingRule.where({
      zoneId: fixture.zoneId,
    }).all()) {
      await db.DeliveryPricingRule.where({ id: rule.id }).delete();
    }
    await db.DeliveryZone.where({ id: fixture.zoneId }).delete();
  }

  it('previews without redeeming; orders redeem once with merchant-funded math', async () => {
    const suffix = Date.now().toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const code = `M${suffix}`;
      const promo = await promotions.createPromotion({
        code,
        type: PROMOTION_TYPE_MERCHANT_RATE_BPS,
        value: 1000,
        startsAt: '2020-01-01T00:00:00.000Z',
        endsAt: '2099-01-01T00:00:00.000Z',
      });
      fixture.promoIds.push(promo.id);

      const server = app.getHttpServer();
      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({ productId: fixture.productId, quantity: 1, optionIds: [] });

      const preview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({ addressId: fixture.addressId, promoCode: code });
      expect(preview.status).toBe(200);
      const body = preview.body as PreviewBody;
      expect(body.merchandiseSubtotalMinor).toBe(10000);
      expect(body.discountMinor).toBe(1000);
      expect(body.promoCode).toBe(code.toUpperCase());
      expect(body.deliveryFeeMinor).toBe(500);
      expect(body.customerTotalMinor).toBe(9500);
      const redemptionsBefore = await prisma
        .getDb()
        .orm.public.PromotionRedemption.where({ promotionId: promo.id })
        .all();
      expect(redemptionsBefore).toHaveLength(0);

      const created = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({
          addressId: fixture.addressId,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: 10000,
          expectedDeliveryFeeMinor: 500,
          expectedCustomerTotalMinor: 9500,
          promoCode: code,
        });
      expect(created.status).toBe(201);
      const orderId = (created.body as { id: string }).id;
      const snapshot = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({ orderId })
        .first();
      expect(Number(snapshot!.merchantDiscountMinor)).toBe(1000);
      expect(Number(snapshot!.platformDiscountMinor)).toBe(0);
      expect(Number(snapshot!.commissionBaseMinor)).toBe(10000);
      expect(Number(snapshot!.merchantCommissionAmountMinor)).toBe(700);
      expect(Number(snapshot!.merchantNetAmountMinor)).toBe(8300);
      expect(Number(snapshot!.customerPayableMinor)).toBe(9500);
      expect(Number(snapshot!.customerDeliveryFeeMinor)).toBe(500);
      expect(Number(snapshot!.driverRemunerationMinor)).toBe(300);

      const payment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId })
        .first();
      expect(Number(payment!.amountMinor)).toBe(9500);

      const redemptions = await prisma
        .getDb()
        .orm.public.PromotionRedemption.where({ orderId })
        .all();
      expect(redemptions).toHaveLength(1);
      expect(redemptions[0].fundedBy).toBe('MERCHANT');
      expect(Number(redemptions[0].discountAmountMinor)).toBe(1000);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('fails Order create when explicit promo is deactivated after preview', async () => {
    const suffix = (Date.now() + 1).toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const code = `D${suffix}`;
      const promo = await promotions.createPromotion({
        code,
        type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
        value: 2000,
        startsAt: '2020-01-01T00:00:00.000Z',
        endsAt: '2099-01-01T00:00:00.000Z',
      });
      fixture.promoIds.push(promo.id);

      const server = app.getHttpServer();
      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({ productId: fixture.productId, quantity: 1, optionIds: [] });
      const preview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({ addressId: fixture.addressId, promoCode: code });
      expect(preview.status).toBe(200);
      expect((preview.body as PreviewBody).customerTotalMinor).toBe(8500);

      await promotions.setPromotionActive(promo.id, false);

      const created = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({
          addressId: fixture.addressId,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: 10000,
          expectedDeliveryFeeMinor: 500,
          expectedCustomerTotalMinor: 8500,
          promoCode: code,
        });
      expect(created.status).toBe(409);
      expect((created.body as { error: { code: string } }).error.code).toBe(
        'PROMOTION_INACTIVE',
      );
      expect(
        await prisma
          .getDb()
          .orm.public.PromotionRedemption.where({ promotionId: promo.id })
          .all(),
      ).toHaveLength(0);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('keeps Merchant net intact for SPEEDYGO-funded discount', async () => {
    const suffix = (Date.now() + 2).toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const code = `P${suffix}`;
      const promo = await promotions.createPromotion({
        code,
        type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
        value: 2000,
        startsAt: '2020-01-01T00:00:00.000Z',
        endsAt: '2099-01-01T00:00:00.000Z',
      });
      fixture.promoIds.push(promo.id);

      const server = app.getHttpServer();
      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({ productId: fixture.productId, quantity: 1, optionIds: [] });
      const created = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({
          addressId: fixture.addressId,
          paymentMethod: 'ELECTRONIC',
          expectedMerchandiseSubtotalMinor: 10000,
          expectedDeliveryFeeMinor: 500,
          expectedCustomerTotalMinor: 8500,
          promoCode: code,
        });
      expect(created.status).toBe(201);
      const orderId = (created.body as { id: string }).id;
      const snapshot = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({ orderId })
        .first();
      expect(Number(snapshot!.platformDiscountMinor)).toBe(2000);
      expect(Number(snapshot!.merchantDiscountMinor)).toBe(0);
      expect(Number(snapshot!.merchantNetAmountMinor)).toBe(9300);
      expect(Number(snapshot!.commissionBaseMinor)).toBe(10000);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('blocks zero Customer payable at preview and Order create', async () => {
    const suffix = (Date.now() + 3).toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix, {
        deliveryFeeMinor: 0,
        driverRemunerationMinor: 0,
      });
      const code = `Z${suffix}`;
      // SpeedyGo-funded: Merchant net stays non-negative while Customer payable hits 0.
      const promo = await promotions.createPromotion({
        code,
        type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
        value: 10000,
        startsAt: '2020-01-01T00:00:00.000Z',
        endsAt: '2099-01-01T00:00:00.000Z',
      });
      fixture.promoIds.push(promo.id);

      const server = app.getHttpServer();
      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({ productId: fixture.productId, quantity: 1, optionIds: [] });

      const preview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({ addressId: fixture.addressId, promoCode: code });
      expect(preview.status).toBe(409);
      expect((preview.body as { error: { code: string } }).error.code).toBe(
        'PROMOTION_ZERO_PAYABLE_UNSUPPORTED',
      );
      expect(
        await prisma
          .getDb()
          .orm.public.PromotionRedemption.where({ promotionId: promo.id })
          .all(),
      ).toHaveLength(0);

      const created = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({
          addressId: fixture.addressId,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: 10000,
          expectedDeliveryFeeMinor: 0,
          expectedCustomerTotalMinor: 0,
          promoCode: code,
        });
      expect(created.status).toBe(409);
      expect((created.body as { error: { code: string } }).error.code).toBe(
        'PROMOTION_ZERO_PAYABLE_UNSUPPORTED',
      );
      expect(
        await prisma
          .getDb()
          .orm.public.PromotionRedemption.where({ promotionId: promo.id })
          .all(),
      ).toHaveLength(0);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('allows full merchandise discount when delivery keeps payable positive', async () => {
    const suffix = (Date.now() + 4).toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const code = `F${suffix}`;
      // SpeedyGo-funded full GMS discount keeps Merchant net = GMS − commission.
      const promo = await promotions.createPromotion({
        code,
        type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
        value: 10000,
        startsAt: '2020-01-01T00:00:00.000Z',
        endsAt: '2099-01-01T00:00:00.000Z',
      });
      fixture.promoIds.push(promo.id);

      const server = app.getHttpServer();
      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({ productId: fixture.productId, quantity: 1, optionIds: [] });
      const preview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({ addressId: fixture.addressId, promoCode: code });
      expect(preview.status).toBe(200);
      expect((preview.body as PreviewBody).customerTotalMinor).toBe(500);

      const created = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({
          addressId: fixture.addressId,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: 10000,
          expectedDeliveryFeeMinor: 500,
          expectedCustomerTotalMinor: 500,
          promoCode: code,
        });
      expect(created.status).toBe(201);
      const orderId = (created.body as { id: string }).id;
      const snapshot = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({ orderId })
        .first();
      expect(Number(snapshot!.platformDiscountMinor)).toBe(10000);
      expect(Number(snapshot!.merchantDiscountMinor)).toBe(0);
      expect(Number(snapshot!.customerPayableMinor)).toBe(500);
      expect(Number(snapshot!.commissionBaseMinor)).toBe(10000);
      expect(Number(snapshot!.merchantNetAmountMinor)).toBe(9300);
      expect(Number(snapshot!.driverRemunerationMinor)).toBe(300);
      const payment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId })
        .first();
      expect(Number(payment!.amountMinor)).toBe(500);
      expect(
        await prisma
          .getDb()
          .orm.public.FinancialLedgerEntry.where({ orderId })
          .all(),
      ).toHaveLength(0);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('allows the same GLOBAL code for different Customers (no usage limits)', async () => {
    const suffix = (Date.now() + 5).toString().slice(-6);
    let fixture: Fixture | undefined;
    let secondStoredPhone: string | undefined;
    try {
      fixture = await createFixture(suffix);
      const code = `R${suffix}`;
      const promo = await promotions.createPromotion({
        code,
        type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
        value: 1000,
        startsAt: '2020-01-01T00:00:00.000Z',
        endsAt: '2099-01-01T00:00:00.000Z',
      });
      fixture.promoIds.push(promo.id);

      const server = app.getHttpServer();
      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({ productId: fixture.productId, quantity: 1, optionIds: [] });
      const first = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${fixture.customerToken}`)
        .send({
          addressId: fixture.addressId,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: 10000,
          expectedDeliveryFeeMinor: 500,
          expectedCustomerTotalMinor: 9500,
          promoCode: code,
        });
      expect(first.status).toBe(201);

      const secondToken = await authenticate(`0583${suffix}`);
      secondStoredPhone = (await authMe(secondToken)).phone;
      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${secondToken}`)
        .send({ fullName: 'Promo Customer B' });
      const addressB = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${secondToken}`)
        .send({
          label: 'Home',
          addressText: 'Promo dropoff B',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      expect(addressB.status).toBe(201);
      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${secondToken}`)
        .send({ productId: fixture.productId, quantity: 1, optionIds: [] });
      const second = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${secondToken}`)
        .send({
          addressId: (addressB.body as { id: string }).id,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: 10000,
          expectedDeliveryFeeMinor: 500,
          expectedCustomerTotalMinor: 9500,
          promoCode: code,
        });
      expect(second.status).toBe(201);
      expect(
        await prisma
          .getDb()
          .orm.public.PromotionRedemption.where({ promotionId: promo.id })
          .all(),
      ).toHaveLength(2);
    } finally {
      if (secondStoredPhone) await cleanupByPhone(secondStoredPhone);
      if (fixture) await cleanupFixture(fixture);
    }
  });
});
