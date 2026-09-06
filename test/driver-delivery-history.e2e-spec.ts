import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MONEY_MINOR_ABOVE_SAFE_INTEGER } from '../src/common/money/money-minor';
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
import { DriverReviewService } from '../src/modules/drivers/application/driver-review.service';
import { MatchingService } from '../src/modules/matching/application/matching.service';
import { MATCHING_QUEUE_NAME } from '../src/modules/matching/domain/matching.jobs';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '../src/modules/matching/domain/matching.types';
import { MatchingProcessor } from '../src/modules/matching/infrastructure/matching.processor';

type TokenBody = { accessToken: string };
type AuthMeBody = { account: { id: string; phone: string } };
type PreviewBody = {
  merchandiseSubtotalMinor: string;
  deliveryFeeMinor: string;
  customerTotalMinor: string;
};
type AcceptedBody = {
  assignmentId: string;
  deliveryId: string;
  driverRemunerationMinor: string;
};
type HistoryEarningBody = {
  earningId: string;
  earningAmountMinor: string;
  currency: string;
  earningStatus: string;
  earnedAt: string;
};
type HistoryItemBody = {
  deliveryId: string;
  orderPublicReference: string;
  deliveryStatus: string;
  deliveredAt: string;
  merchantName: string;
  branchName: string;
  paymentMethod: string | null;
  earning: HistoryEarningBody;
};
type HistoryListBody = {
  items: HistoryItemBody[];
  total: number;
  limit: number;
  offset: number;
};
type HistoryDetailBody = HistoryItemBody & {
  pickedUpAt: string | null;
  arrivedCustomerAt: string | null;
};
type ErrorBody = { error: { code: string } };

const INSIDE: [number, number] = [36.75, 3.05];
const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];
const LOGISTICS_ACTIONS = [
  'start-to-pickup',
  'arrive-pickup',
  'confirm-pickup',
  'start-delivery',
  'arrive-customer',
] as const;
const FORBIDDEN_HISTORY_KEYS = [
  'orderId',
  'assignmentId',
  'customerId',
  'customerName',
  'customerPhone',
  'email',
  'addressText',
  'latitude',
  'longitude',
  'tracking',
  'ratingComment',
  'merchantCommission',
  'merchantNet',
  'settlement',
  'codOutstanding',
  'paidAt',
] as const;

function moneyMinorString(value: bigint | string | number): string {
  if (typeof value === 'bigint') {
    return value.toString(10);
  }
  return String(value);
}

describe('Driver Delivery History (e2e)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let matching: MatchingService;
  let review: DriverReviewService;
  let locations: DriverLocationStore;
  let queue: Queue;

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
    matching = app.get(MatchingService);
    review = app.get(DriverReviewService);
    locations = app.get(DRIVER_LOCATION_STORE);
    queue = app.get<Queue>(getQueueToken(MATCHING_QUEUE_NAME));

    await queue.obliterate({ force: true });
    for (const pattern of [
      'auth:test:*',
      'matching:test:*',
      'bull:matching:test*',
      'tracking:test:*',
    ]) {
      const keys = await redis.getClient().keys(pattern);
      if (keys.length > 0) {
        await redis.getClient().del(...keys);
      }
    }
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
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
        deviceName: 'driver-delivery-history-e2e',
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

  async function onboardApprovedDriver(
    token: string,
    name: string,
    plate: string,
  ): Promise<string> {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/v1/driver/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: name });
    await request(server)
      .put('/api/v1/driver/documents/IDENTITY')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    await request(server)
      .put('/api/v1/driver/documents/DRIVING_LICENSE')
      .set('Authorization', `Bearer ${token}`)
      .send({ expiryDate: '2099-12-31' });
    await request(server)
      .post('/api/v1/driver/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'MOTORCYCLE', plateNumber: plate, model: 'NMAX' });
    const submitted = await request(server)
      .post('/api/v1/driver/verification/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(submitted.status).toBe(200);
    const driverId = (submitted.body as { profile: { id: string } }).profile.id;
    await review.approve(driverId);
    const online = await request(server)
      .post('/api/v1/driver/availability/go-online')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(online.status).toBe(200);
    return driverId;
  }

  async function cleanupByPhone(phoneE164: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    const account = await db.Account.where({ phone: phoneE164 }).first();
    if (!account) return;

    const driver = await db.DriverProfile.where({
      accountId: account.id,
    }).first();
    if (driver) {
      for (const entry of await db.FinancialLedgerEntry.where({
        driverId: driver.id,
      }).all()) {
        await db.FinancialLedgerEntry.where({ id: entry.id }).delete();
      }
      const remittances = await db.CodRemittance.where({
        driverId: driver.id,
      }).all();
      for (const remittance of remittances) {
        const discrepancy = await db.CodDiscrepancy.where({
          remittanceId: remittance.id,
        }).first();
        if (discrepancy) {
          await db.CodDiscrepancy.where({ id: discrepancy.id }).delete();
        }
        const allocations = await db.CodRemittanceAllocation.where({
          remittanceId: remittance.id,
        }).all();
        for (const allocation of allocations) {
          await db.CodRemittanceAllocation.where({
            id: allocation.id,
          }).delete();
        }
        await db.CodRemittance.where({ id: remittance.id }).delete();
      }
      for (const row of await db.CodCollection.where({
        driverId: driver.id,
      }).all()) {
        await db.CodCollection.where({ id: row.id }).delete();
      }
      for (const row of await db.DriverEarning.where({
        driverId: driver.id,
      }).all()) {
        await db.DriverEarning.where({ id: row.id }).delete();
      }
      for (const row of await db.DriverAssignment.where({
        driverId: driver.id,
      }).all()) {
        await db.DriverAssignment.where({ id: row.id }).delete();
      }
      for (const row of await db.DriverDocument.where({
        driverId: driver.id,
      }).all()) {
        await db.DriverDocument.where({ id: row.id }).delete();
      }
      for (const row of await db.Vehicle.where({ driverId: driver.id }).all()) {
        await db.Vehicle.where({ id: row.id }).delete();
      }
      for (const entry of await db.FinancialLedgerEntry.where({
        driverId: driver.id,
      }).all()) {
        await db.FinancialLedgerEntry.where({ id: entry.id }).delete();
      }
      await db.DriverProfile.where({ id: driver.id }).delete();
    }

    const customer = await db.CustomerProfile.where({
      accountId: account.id,
    }).first();
    if (customer) {
      const orders = await db.Order.where({ customerId: customer.id }).all();
      for (const order of orders) {
        const delivery = await db.Delivery.where({ orderId: order.id }).first();
        if (delivery) {
          const proof = await db.DeliveryProof.where({
            deliveryId: delivery.id,
          }).first();
          if (proof) {
            await db.DeliveryProof.where({ id: proof.id }).delete();
          }
          // DriverEarning owns a restrictive delivery FK and must be deleted first.
          for (const row of await db.DriverEarning.where({
            deliveryId: delivery.id,
          }).all()) {
            await db.DriverEarning.where({ id: row.id }).delete();
          }
          for (const row of await db.DeliveryEvent.where({
            deliveryId: delivery.id,
          }).all()) {
            await db.DeliveryEvent.where({ id: row.id }).delete();
          }
          for (const row of await db.DriverAssignment.where({
            deliveryId: delivery.id,
          }).all()) {
            await db.DriverAssignment.where({ id: row.id }).delete();
          }
          await db.Delivery.where({ id: delivery.id }).delete();
        }
        for (const collection of await db.CodCollection.where({
          orderId: order.id,
        }).all()) {
          for (const allocation of await db.CodRemittanceAllocation.where({
            collectionId: collection.id,
          }).all()) {
            await db.CodRemittanceAllocation.where({
              id: allocation.id,
            }).delete();
          }
          await db.CodCollection.where({ id: collection.id }).delete();
        }
        for (const payment of await db.Payment.where({
          orderId: order.id,
        }).all()) {
          for (const transaction of await db.PaymentTransaction.where({
            paymentId: payment.id,
          }).all()) {
            await db.PaymentTransaction.where({
              id: transaction.id,
            }).delete();
          }
          await db.Payment.where({ id: payment.id }).delete();
        }
        for (const event of await db.OrderStatusEvent.where({
          orderId: order.id,
        }).all()) {
          await db.OrderStatusEvent.where({ id: event.id }).delete();
        }
        const cancellation = await db.OrderCancellation.where({
          orderId: order.id,
        }).first();
        if (cancellation) {
          await db.OrderCancellation.where({ id: cancellation.id }).delete();
        }
        for (const item of await db.OrderItem.where({
          orderId: order.id,
        }).all()) {
          for (const option of await db.OrderItemOption.where({
            orderItemId: item.id,
          }).all()) {
            await db.OrderItemOption.where({ id: option.id }).delete();
          }
          await db.OrderItem.where({ id: item.id }).delete();
        }
        await db.OrderFinancialSnapshot.where({ orderId: order.id }).delete();
        await db.OrderDeliveryAddressSnapshot.where({
          orderId: order.id,
        }).delete();
        for (const entry of await db.FinancialLedgerEntry.where({
          orderId: order.id,
        }).all()) {
          await db.FinancialLedgerEntry.where({ id: entry.id }).delete();
        }
        await db.Order.where({ id: order.id }).delete();
      }
      for (const cart of await db.Cart.where({
        customerId: customer.id,
      }).all()) {
        await db.Cart.where({ id: cart.id }).delete();
      }
      for (const address of await db.Address.where({
        customerId: customer.id,
      }).all()) {
        await db.Address.where({ id: address.id }).delete();
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
        for (const cart of await db.Cart.where({
          merchantBranchId: branch.id,
        }).all()) {
          await db.Cart.where({ id: cart.id }).delete();
        }
        for (const product of await db.Product.where({
          merchantBranchId: branch.id,
        }).all()) {
          await db.Product.where({ id: product.id }).delete();
        }
        for (const category of await db.Category.where({
          merchantBranchId: branch.id,
        }).all()) {
          await db.Category.where({ id: category.id }).delete();
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
      await db.Device.where({ id: device.id }).delete();
    }
    await deleteAccountNotificationArtifacts(prisma, account.id);

    await db.Account.where({ id: account.id }).delete();
  }

  type Fixture = {
    suffix: string;
    customerToken: string;
    ownerToken: string;
    driverToken: string;
    foreignToken: string;
    driverId: string;
    foreignDriverId: string;
    merchantId: string;
    productId: string;
    addressId: string;
    phones: string[];
    zoneId: string;
    adminId: string;
    roleId: string;
  };

  async function createFixture(suffix: string): Promise<Fixture> {
    await deactivateAllDeliveryZones(prisma);
    let zoneId: string | undefined;
    let phones: string[] = [];
    try {
      const server = app.getHttpServer();
      const rawPhones = [
        `0591${suffix}`,
        `0592${suffix}`,
        `0593${suffix}`,
        `0594${suffix}`,
      ];
      const tokens: string[] = [];
      for (const phone of rawPhones) {
        // TestOtpSender exposes one lastCode, so OTP exchanges must stay serial.
        tokens.push(await authenticate(phone));
      }
      const [customerToken, ownerToken, driverToken, foreignToken] = tokens;
      const accounts = await Promise.all(
        [customerToken, ownerToken, driverToken, foreignToken].map(authMe),
      );
      phones = accounts.map((account) => account.phone);

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ fullName: 'History Customer' });
      const address = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          label: 'Home',
          addressText: 'History dropoff',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      expect(address.status).toBe(201);

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: `History Cafe ${suffix}` });
      const merchantId = (merchant.body as { merchantId: string }).merchantId;
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Main',
          phone: `0595${suffix}`,
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
          name: 'History meal',
          priceMinor: 1200,
        });

      const now = pgNow();
      zoneId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`History zone ${suffix}`),
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
      const roleId = createUuidV7();
      await prisma.getDb().orm.public.Role.create({
        id: roleId,
        name: pgVarchar<128>(`history-e2e-${suffix}`),
        description: null,
        active: true,
      });
      const adminId = createUuidV7();
      await prisma.getDb().orm.public.AdminProfile.create({
        id: adminId,
        accountId: accounts[1].id,
        roleId,
        displayName: pgVarchar<255>('History Admin'),
        twoFactorEnabled: false,
        createdAt: now,
        updatedAt: now,
      });
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

      const driverId = await onboardApprovedDriver(
        driverToken,
        'History Driver A',
        `HA${suffix}`,
      );
      const foreignDriverId = await onboardApprovedDriver(
        foreignToken,
        'History Driver B',
        `HB${suffix}`,
      );
      await locations.upsert(
        driverId,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      await locations.upsert(
        foreignDriverId,
        36.79,
        3.09,
        new Date().toISOString(),
      );

      return {
        suffix,
        customerToken,
        ownerToken,
        driverToken,
        foreignToken,
        driverId,
        foreignDriverId,
        merchantId,
        productId: (product.body as { id: string }).id,
        addressId: (address.body as { id: string }).id,
        phones,
        zoneId,
        adminId,
        roleId,
      };
    } catch (error) {
      if (zoneId) {
        await prisma
          .getDb()
          .orm.public.DeliveryZone.where({ id: zoneId })
          .update({ active: false, updatedAt: pgNow() });
      }
      for (const phone of phones) {
        await cleanupByPhone(phone).catch(() => undefined);
      }
      throw error;
    }
  }

  async function cleanupFixture(fixture: Fixture): Promise<void> {
    if (fixture.phones[0]) await cleanupByPhone(fixture.phones[0]);
    const db = prisma.getDb().orm.public;
    for (const rule of await db.MerchantCommissionRule.where({
      changedByAdminId: fixture.adminId,
    }).all()) {
      await db.MerchantCommissionRule.where({ id: rule.id }).delete();
    }
    await db.AdminProfile.where({ id: fixture.adminId }).delete();
    await db.Role.where({ id: fixture.roleId }).delete();
    for (const rule of await db.DeliveryPricingRule.where({
      zoneId: fixture.zoneId,
    }).all()) {
      await db.DeliveryPricingRule.where({ id: rule.id }).delete();
    }
    await db.DeliveryZone.where({ id: fixture.zoneId }).delete();
    for (const phone of fixture.phones.slice(1)) {
      await cleanupByPhone(phone);
    }
  }

  async function createReadyOrder(fixture: Fixture): Promise<string> {
    const server = app.getHttpServer();
    const added = await request(server)
      .post('/api/v1/customer/cart/items')
      .set('Authorization', `Bearer ${fixture.customerToken}`)
      .send({ productId: fixture.productId, quantity: 1, optionIds: [] });
    expect(added.status).toBe(200);
    const preview = await request(server)
      .post('/api/v1/customer/checkout/preview')
      .set('Authorization', `Bearer ${fixture.customerToken}`)
      .send({ addressId: fixture.addressId });
    expect(preview.status).toBe(200);
    const created = await request(server)
      .post('/api/v1/customer/orders')
      .set('Authorization', `Bearer ${fixture.customerToken}`)
      .send({
        addressId: fixture.addressId,
        paymentMethod: 'ELECTRONIC',
        expectedMerchandiseSubtotalMinor: Number(
          (preview.body as PreviewBody).merchandiseSubtotalMinor,
        ),
        expectedDeliveryFeeMinor: Number(
          (preview.body as PreviewBody).deliveryFeeMinor,
        ),
        expectedCustomerTotalMinor: Number(
          (preview.body as PreviewBody).customerTotalMinor,
        ),
      });
    if (created.status !== 201) {
      throw new Error(
        `createReadyOrder failed status=${created.status} body=${JSON.stringify(created.body)}`,
      );
    }
    const orderId = (created.body as { id: string }).id;
    const accepted = await request(server)
      .post(`/api/v1/merchant/${fixture.merchantId}/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({});
    expect(accepted.status).toBe(200);
    await prisma
      .getDb()
      .orm.public.Payment.where({ orderId })
      .update({ status: 'SUCCEEDED', updatedAt: pgNow() });
    const preparing = await request(server)
      .post(
        `/api/v1/merchant/${fixture.merchantId}/orders/${orderId}/start-preparation`,
      )
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({});
    expect(preparing.status).toBe(200);
    const ready = await request(server)
      .post(
        `/api/v1/merchant/${fixture.merchantId}/orders/${orderId}/mark-ready`,
      )
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({});
    expect(ready.status).toBe(200);
    return orderId;
  }

  async function acceptOffer(
    token: string,
    assignmentId: string,
  ): Promise<AcceptedBody> {
    const accepted = await request(app.getHttpServer())
      .post(`/api/v1/driver/assignments/${assignmentId}/accept`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(accepted.status).toBe(200);
    return accepted.body as AcceptedBody;
  }

  async function runLogisticsAndComplete(
    token: string,
    driverId: string,
  ): Promise<void> {
    const server = app.getHttpServer();
    for (const action of LOGISTICS_ACTIONS) {
      if (action === 'arrive-pickup' || action === 'arrive-customer') {
        await locations.upsert(
          driverId,
          36.7504,
          3.0504,
          new Date().toISOString(),
        );
      }
      const step = await request(server)
        .post(`/api/v1/driver/deliveries/current/${action}`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(step.status).toBe(200);
    }
    const completed = await request(server)
      .post('/api/v1/driver/deliveries/current/complete-delivery')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(completed.status).toBe(200);
  }

  it('covers completed history list/detail, auth, privacy, economics, and reject isolation', async () => {
    const suffix = Date.now().toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const server = app.getHttpServer();
      const db = prisma.getDb().orm.public;

      const unauthenticated = await request(server).get(
        '/api/v1/driver/deliveries/history',
      );
      expect(unauthenticated.status).toBe(401);

      const placeholderDeliveryId = createUuidV7();
      for (const token of [fixture.customerToken, fixture.ownerToken]) {
        const listDenied = await request(server)
          .get('/api/v1/driver/deliveries/history')
          .set('Authorization', `Bearer ${token}`);
        expect(listDenied.status).toBe(404);
        expect((listDenied.body as ErrorBody).error.code).toBe(
          'DRIVER_PROFILE_NOT_FOUND',
        );
        const detailDenied = await request(server)
          .get(`/api/v1/driver/deliveries/history/${placeholderDeliveryId}`)
          .set('Authorization', `Bearer ${token}`);
        expect(detailDenied.status).toBe(404);
        expect((detailDenied.body as ErrorBody).error.code).toBe(
          'DRIVER_PROFILE_NOT_FOUND',
        );
      }

      const overLimit = await request(server)
        .get('/api/v1/driver/deliveries/history')
        .query({ limit: 101 })
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(overLimit.status).toBe(400);

      const orderId1 = await createReadyOrder(fixture);
      const offered1 = await matching.startForReadyOrder(orderId1);
      expect(offered1.offered).toBe(true);
      expect(offered1.assignment?.driverId).toBe(fixture.driverId);
      const accepted1 = await acceptOffer(
        fixture.driverToken,
        offered1.assignment!.id,
      );
      expect(accepted1.driverRemunerationMinor).toBe('300');

      const midHistory = await request(server)
        .get('/api/v1/driver/deliveries/history')
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(midHistory.status).toBe(200);
      const midBody = midHistory.body as HistoryListBody;
      expect(
        midBody.items.some((item) => item.deliveryId === accepted1.deliveryId),
      ).toBe(false);

      await runLogisticsAndComplete(fixture.driverToken, fixture.driverId);

      const order1 = await db.Order.where({ id: orderId1 }).first();
      expect(order1).not.toBeNull();
      const earning1 = await db.DriverEarning.where({
        deliveryId: accepted1.deliveryId,
      }).first();
      expect(earning1).not.toBeNull();
      const expectedEarning1 = moneyMinorString(earning1!.netEarningMinor);

      const listed1 = await request(server)
        .get('/api/v1/driver/deliveries/history')
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(listed1.status).toBe(200);
      const list1 = listed1.body as HistoryListBody;
      expect(list1.total).toBeGreaterThanOrEqual(1);
      const item1 = list1.items.find(
        (item) => item.deliveryId === accepted1.deliveryId,
      );
      expect(item1?.deliveryId).toBe(accepted1.deliveryId);
      expect(item1?.orderPublicReference).toBe(order1!.publicReference);
      expect(item1?.deliveryStatus).toBe('DELIVERED');
      expect(item1?.merchantName).toBe(`History Cafe ${suffix}`);
      expect(item1?.branchName).toBe('Main');
      expect(item1?.paymentMethod).toBe('ELECTRONIC');
      expect(item1?.earning.earningId).toBe(earning1!.id);
      expect(item1?.earning.earningAmountMinor).toBe(expectedEarning1);
      expect(item1?.earning.currency).toBe('DZD');
      expect(item1?.earning.earningStatus).toBe('EARNED');
      expect(typeof item1?.deliveredAt).toBe('string');
      expect(item1!.deliveredAt.length).toBeGreaterThan(0);
      expect(item1!.earning.earningAmountMinor).toBe(expectedEarning1);

      const detailOwner = await request(server)
        .get(`/api/v1/driver/deliveries/history/${accepted1.deliveryId}`)
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(detailOwner.status).toBe(200);
      const detail = detailOwner.body as HistoryDetailBody;
      expect(detail.deliveredAt).toBe(item1!.deliveredAt);
      expect(detail.earning.earningAmountMinor).toBe(expectedEarning1);
      expect(detail.deliveryId).toBe(accepted1.deliveryId);
      for (const key of FORBIDDEN_HISTORY_KEYS) {
        expect(detail).not.toHaveProperty(key);
        expect(item1).not.toHaveProperty(key);
      }

      const foreignDetail = await request(server)
        .get(`/api/v1/driver/deliveries/history/${accepted1.deliveryId}`)
        .set('Authorization', `Bearer ${fixture.foreignToken}`);
      expect(foreignDetail.status).toBe(404);
      expect((foreignDetail.body as ErrorBody).error.code).toBe(
        'DRIVER_DELIVERY_HISTORY_NOT_FOUND',
      );

      const bareDate = await request(server)
        .get('/api/v1/driver/deliveries/history')
        .query({ from: '2024-01-01', to: '2024-01-02' })
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(bareDate.status).toBe(400);
      expect((bareDate.body as ErrorBody).error.code).toBe(
        'DRIVER_DELIVERY_HISTORY_QUERY_INVALID',
      );

      const excludedWindow = await request(server)
        .get('/api/v1/driver/deliveries/history')
        .query({
          from: '2020-01-01T00:00:00.000Z',
          to: '2020-01-02T00:00:00.000Z',
        })
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(excludedWindow.status).toBe(200);
      expect((excludedWindow.body as HistoryListBody).items).toHaveLength(0);
      expect((excludedWindow.body as HistoryListBody).total).toBe(0);

      const deliveredMs = Date.parse(item1!.deliveredAt);
      const includedFrom = new Date(deliveredMs - 60_000).toISOString();
      const includedTo = new Date(deliveredMs + 60_000).toISOString();
      const includedWindow = await request(server)
        .get('/api/v1/driver/deliveries/history')
        .query({ from: includedFrom, to: includedTo })
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(includedWindow.status).toBe(200);
      expect(
        (includedWindow.body as HistoryListBody).items.some(
          (item) => item.deliveryId === accepted1.deliveryId,
        ),
      ).toBe(true);

      const originalEarningAmount = expectedEarning1;
      const pricingRules = await db.DeliveryPricingRule.where({
        zoneId: fixture.zoneId,
      }).all();
      expect(pricingRules.length).toBeGreaterThanOrEqual(1);
      await db.DeliveryPricingRule.where({ id: pricingRules[0].id }).update({
        driverRemunerationMinor: pgBigInt(9999),
        updatedAt: pgNow(),
      });
      const afterPricing = await request(server)
        .get(`/api/v1/driver/deliveries/history/${accepted1.deliveryId}`)
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(afterPricing.status).toBe(200);
      expect(
        (afterPricing.body as HistoryDetailBody).earning.earningAmountMinor,
      ).toBe(originalEarningAmount);

      await db.DriverEarning.where({ id: earning1!.id }).update({
        baseRemunerationMinor: pgBigInt(MONEY_MINOR_ABOVE_SAFE_INTEGER),
        netEarningMinor: pgBigInt(MONEY_MINOR_ABOVE_SAFE_INTEGER),
        updatedAt: pgNow(),
      });
      const afterBig = await request(server)
        .get(`/api/v1/driver/deliveries/history/${accepted1.deliveryId}`)
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(afterBig.status).toBe(200);
      expect(
        (afterBig.body as HistoryDetailBody).earning.earningAmountMinor,
      ).toBe(MONEY_MINOR_ABOVE_SAFE_INTEGER);
      const listedBig = await request(server)
        .get('/api/v1/driver/deliveries/history')
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(listedBig.status).toBe(200);
      const bigItem = (listedBig.body as HistoryListBody).items.find(
        (item) => item.deliveryId === accepted1.deliveryId,
      );
      expect(bigItem?.earning.earningAmountMinor).toBe(
        MONEY_MINOR_ABOVE_SAFE_INTEGER,
      );

      // Restore live pricing so subsequent Order creates use the fixture fee/remuneration.
      await db.DeliveryPricingRule.where({ id: pricingRules[0].id }).update({
        driverRemunerationMinor: pgBigInt(300),
        updatedAt: pgNow(),
      });

      await locations.upsert(
        fixture.driverId,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      const orderId2 = await createReadyOrder(fixture);
      const offered2 = await matching.startForReadyOrder(orderId2);
      expect(offered2.offered).toBe(true);
      expect(offered2.assignment?.driverId).toBe(fixture.driverId);
      const accepted2 = await acceptOffer(
        fixture.driverToken,
        offered2.assignment!.id,
      );
      await runLogisticsAndComplete(fixture.driverToken, fixture.driverId);

      await db.Delivery.where({ id: accepted1.deliveryId }).update({
        deliveredAt: pgTimestamptz('2024-01-01T12:00:00.000Z'),
        updatedAt: pgNow(),
      });
      await db.Delivery.where({ id: accepted2.deliveryId }).update({
        deliveredAt: pgTimestamptz('2024-06-15T12:00:00.000Z'),
        updatedAt: pgNow(),
      });

      const ordered = await request(server)
        .get('/api/v1/driver/deliveries/history')
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(ordered.status).toBe(200);
      const orderedBody = ordered.body as HistoryListBody;
      expect(orderedBody.total).toBeGreaterThanOrEqual(2);
      expect(orderedBody.items[0]?.deliveryId).toBe(accepted2.deliveryId);
      expect(orderedBody.items[1]?.deliveryId).toBe(accepted1.deliveryId);

      const paged = await request(server)
        .get('/api/v1/driver/deliveries/history')
        .query({ limit: 1 })
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(paged.status).toBe(200);
      const pageBody = paged.body as HistoryListBody;
      expect(pageBody.items).toHaveLength(1);
      expect(pageBody.total).toBeGreaterThanOrEqual(2);
      expect(pageBody.limit).toBe(1);
      expect(pageBody.items[0]?.deliveryId).toBe(accepted2.deliveryId);

      await locations.upsert(
        fixture.driverId,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      await locations.upsert(
        fixture.foreignDriverId,
        36.753,
        3.053,
        new Date().toISOString(),
      );
      const orderId3 = await createReadyOrder(fixture);
      const offered3 = await matching.startForReadyOrder(orderId3);
      expect(offered3.offered).toBe(true);
      expect(offered3.assignment?.driverId).toBe(fixture.driverId);
      const rejectedAssignmentId = offered3.assignment!.id;
      const rejectedDeliveryId = offered3.assignment!.deliveryId;

      const accountA = await authMe(fixture.driverToken);
      const afterReject = await matching.reject(
        accountA.id,
        rejectedAssignmentId,
      );
      const rejectedRow = await db.DriverAssignment.where({
        id: rejectedAssignmentId,
      }).first();
      expect(rejectedRow?.status).toBe('REJECTED');

      expect(afterReject.offered).toBe(true);
      expect(afterReject.assignment?.driverId).toBe(fixture.foreignDriverId);
      const acceptedB = await acceptOffer(
        fixture.foreignToken,
        afterReject.assignment!.id,
      );
      expect(acceptedB.deliveryId).toBe(rejectedDeliveryId);
      await runLogisticsAndComplete(
        fixture.foreignToken,
        fixture.foreignDriverId,
      );

      const historyA = await request(server)
        .get('/api/v1/driver/deliveries/history')
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(historyA.status).toBe(200);
      expect(
        (historyA.body as HistoryListBody).items.some(
          (item) => item.deliveryId === rejectedDeliveryId,
        ),
      ).toBe(false);

      const historyB = await request(server)
        .get('/api/v1/driver/deliveries/history')
        .set('Authorization', `Bearer ${fixture.foreignToken}`);
      expect(historyB.status).toBe(200);
      expect(
        (historyB.body as HistoryListBody).items.some(
          (item) => item.deliveryId === rejectedDeliveryId,
        ),
      ).toBe(true);

      const detailB = await request(server)
        .get(`/api/v1/driver/deliveries/history/${rejectedDeliveryId}`)
        .set('Authorization', `Bearer ${fixture.foreignToken}`);
      expect(detailB.status).toBe(200);
      const detailADenied = await request(server)
        .get(`/api/v1/driver/deliveries/history/${rejectedDeliveryId}`)
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(detailADenied.status).toBe(404);
      expect((detailADenied.body as ErrorBody).error.code).toBe(
        'DRIVER_DELIVERY_HISTORY_NOT_FOUND',
      );
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('excludes accepted-then-released non-serving Driver and contradictory earning', async () => {
    const suffix = `${Date.now().toString().slice(-5)}7`;
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const server = app.getHttpServer();
      const db = prisma.getDb().orm.public;

      await locations.upsert(
        fixture.driverId,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );
      await locations.upsert(
        fixture.foreignDriverId,
        36.753,
        3.053,
        new Date().toISOString(),
      );

      const orderId = await createReadyOrder(fixture);
      const offeredA = await matching.startForReadyOrder(orderId);
      expect(offeredA.assignment?.driverId).toBe(fixture.driverId);
      const acceptedA = await acceptOffer(
        fixture.driverToken,
        offeredA.assignment!.id,
      );
      const deliveryId = acceptedA.deliveryId;

      // Adversarial: release Driver A without completing (no production mid-accept route).
      const releasedAt = pgTimestamptz(new Date().toISOString());
      await db.DriverAssignment.where({ id: acceptedA.assignmentId }).update({
        status: pgVarchar<64>('RELEASED'),
        releasedAt,
      });
      await db.Delivery.where({ id: deliveryId }).update({
        status: 'SEARCHING_DRIVER',
        driverSearchStartedAt: pgNow(),
        updatedAt: pgNow(),
      });

      const offeredB = await matching.startForReadyOrder(orderId);
      expect(offeredB.offered).toBe(true);
      expect(offeredB.assignment?.driverId).toBe(fixture.foreignDriverId);
      const acceptedB = await acceptOffer(
        fixture.foreignToken,
        offeredB.assignment!.id,
      );
      expect(acceptedB.deliveryId).toBe(deliveryId);
      await runLogisticsAndComplete(
        fixture.foreignToken,
        fixture.foreignDriverId,
      );

      const aReleased = await db.DriverAssignment.where({
        id: acceptedA.assignmentId,
      }).first();
      expect(aReleased?.status).toBe('RELEASED');
      expect(aReleased?.acceptedAt).toBeTruthy();
      expect(aReleased?.releasedAt).toBeTruthy();
      const earning = await db.DriverEarning.where({ deliveryId }).first();
      expect(earning?.driverId).toBe(fixture.foreignDriverId);

      const listA = await request(server)
        .get('/api/v1/driver/deliveries/history')
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(listA.status).toBe(200);
      expect(
        (listA.body as HistoryListBody).items.some(
          (item) => item.deliveryId === deliveryId,
        ),
      ).toBe(false);

      const detailA = await request(server)
        .get(`/api/v1/driver/deliveries/history/${deliveryId}`)
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(detailA.status).toBe(404);
      expect((detailA.body as ErrorBody).error.code).toBe(
        'DRIVER_DELIVERY_HISTORY_NOT_FOUND',
      );

      const listB = await request(server)
        .get('/api/v1/driver/deliveries/history')
        .set('Authorization', `Bearer ${fixture.foreignToken}`);
      expect(listB.status).toBe(200);
      const itemB = (listB.body as HistoryListBody).items.find(
        (item) => item.deliveryId === deliveryId,
      );
      expect(itemB).toBeDefined();
      expect(itemB?.earning.earningId).toBe(earning!.id);
      expect(itemB?.earning.earningAmountMinor).toBe(
        moneyMinorString(earning!.netEarningMinor),
      );
      for (const key of FORBIDDEN_HISTORY_KEYS) {
        expect(itemB).not.toHaveProperty(key);
      }

      const detailB = await request(server)
        .get(`/api/v1/driver/deliveries/history/${deliveryId}`)
        .set('Authorization', `Bearer ${fixture.foreignToken}`);
      expect(detailB.status).toBe(200);
      for (const key of FORBIDDEN_HISTORY_KEYS) {
        expect(detailB.body).not.toHaveProperty(key);
      }

      // Contradictory: A has RELEASED history on another completed Delivery owned by B's earning.
      // Already true above — additionally assert A never receives B's earningAmountMinor leak.
      const aJson = JSON.stringify(listA.body);
      expect(aJson).not.toContain(earning!.id);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });
});
