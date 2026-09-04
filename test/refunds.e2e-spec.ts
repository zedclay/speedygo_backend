import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
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
import { DriverReviewService } from '../src/modules/drivers/application/driver-review.service';
import { MatchingService } from '../src/modules/matching/application/matching.service';
import { MATCHING_QUEUE_NAME } from '../src/modules/matching/domain/matching.jobs';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '../src/modules/matching/domain/matching.types';
import { MatchingProcessor } from '../src/modules/matching/infrastructure/matching.processor';
import { RefundService } from '../src/modules/refunds/application/refund.service';
import {
  REFUND_METHOD_MANUAL_COD,
  REFUND_METHOD_MANUAL_OTHER,
  REFUND_METHOD_ORIGINAL_PAYMENT,
} from '../src/modules/refunds/domain/refund.types';
import { REFUND_ERROR_CODES } from '../src/modules/refunds/domain/refund.errors';

type TokenBody = { accessToken: string };
type AuthMeBody = { account: { id: string; phone: string } };
type PreviewBody = {
  merchandiseSubtotalMinor: number;
  deliveryFeeMinor: number;
  customerTotalMinor: number;
};
type AcceptedBody = {
  assignmentId: string;
  deliveryId: string;
  driverRemunerationMinor: number;
};
type RefundsBody = {
  orderId: string;
  originalPaidMinor: number;
  reservedRefundMinor: number;
  successfulRefundMinor: number;
  remainingRefundableMinor: number;
  currency: string;
  refunds: Array<{ refundId: string; amountMinor: number; status: string }>;
};

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

describe('Refunds Foundation (e2e)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let matching: MatchingService;
  let review: DriverReviewService;
  let locations: DriverLocationStore;
  let queue: Queue;
  let refunds: RefundService;

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
    refunds = app.get(RefundService);

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
        deviceName: 'refunds-e2e',
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
        for (const refund of await db.Refund.where({
          orderId: order.id,
        }).all()) {
          await db.Refund.where({ id: refund.id }).delete();
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
    foreignToken?: string;
    driverId: string;
    foreignDriverId?: string;
    merchantId: string;
    productId: string;
    addressId: string;
    phones: string[];
    zoneId: string;
    adminId: string;
    roleId: string;
  };

  async function createFixture(
    suffix: string,
    includeForeign: boolean,
  ): Promise<Fixture> {
    const server = app.getHttpServer();
    const rawPhones = [
      `0571${suffix}`,
      `0572${suffix}`,
      `0573${suffix}`,
      ...(includeForeign ? [`0574${suffix}`] : []),
    ];
    const tokens: string[] = [];
    for (const phone of rawPhones) {
      // TestOtpSender exposes one lastCode, so OTP exchanges must stay serial.
      tokens.push(await authenticate(phone));
    }
    const [customerToken, ownerToken, driverToken, foreignToken] = tokens;
    const accounts = await Promise.all(
      [customerToken, ownerToken, driverToken, foreignToken]
        .filter((token): token is string => Boolean(token))
        .map(authMe),
    );

    await request(server)
      .post('/api/v1/customer/profile')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'Remuneration Customer' });
    const address = await request(server)
      .post('/api/v1/customer/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        label: 'Home',
        addressText: 'Remuneration dropoff',
        latitude: INSIDE[0],
        longitude: INSIDE[1],
      });
    expect(address.status).toBe(201);

    const merchant = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Remuneration Cafe ${suffix}` });
    const merchantId = (merchant.body as { merchantId: string }).merchantId;
    const branch = await request(server)
      .post(`/api/v1/merchant/${merchantId}/branches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Main',
        phone: `0550${suffix}`,
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
        name: 'Foundation meal',
        priceMinor: 1200,
      });

    const now = pgNow();
    const zoneId = createUuidV7();
    await prisma.getDb().orm.public.DeliveryZone.create({
      id: zoneId,
      name: pgVarchar<255>(`Remuneration zone ${suffix}`),
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
      name: pgVarchar<128>(`remuneration-e2e-${suffix}`),
      description: null,
      active: true,
    });
    const adminId = createUuidV7();
    await prisma.getDb().orm.public.AdminProfile.create({
      id: adminId,
      accountId: accounts[1].id,
      roleId,
      displayName: pgVarchar<255>('Remuneration Admin'),
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
      'Foundation Driver',
      `RD${suffix}`,
    );
    const foreignDriverId = foreignToken
      ? await onboardApprovedDriver(
          foreignToken,
          'Foreign Foundation Driver',
          `RF${suffix}`,
        )
      : undefined;
    await locations.upsert(driverId, 36.7504, 3.0504, new Date().toISOString());
    if (foreignDriverId) {
      await locations.upsert(
        foreignDriverId,
        36.79,
        3.09,
        new Date().toISOString(),
      );
    }

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
      phones: accounts.map((account) => account.phone),
      zoneId,
      adminId,
      roleId,
    };
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

  async function createReadyOrder(
    fixture: Fixture,
    paymentMethod: 'COD' | 'ELECTRONIC',
  ): Promise<string> {
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
        paymentMethod,
        expectedMerchandiseSubtotalMinor: (preview.body as PreviewBody)
          .merchandiseSubtotalMinor,
        expectedDeliveryFeeMinor: (preview.body as PreviewBody)
          .deliveryFeeMinor,
        expectedCustomerTotalMinor: (preview.body as PreviewBody)
          .customerTotalMinor,
      });
    expect(created.status).toBe(201);
    const orderId = (created.body as { id: string }).id;
    const accepted = await request(server)
      .post(`/api/v1/merchant/${fixture.merchantId}/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({});
    expect(accepted.status).toBe(200);
    if (paymentMethod === 'ELECTRONIC') {
      await prisma
        .getDb()
        .orm.public.Payment.where({ orderId })
        .update({ status: 'SUCCEEDED', updatedAt: pgNow() });
    }
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

  async function acceptAndArrive(
    fixture: Fixture,
    orderId: string,
  ): Promise<AcceptedBody> {
    const server = app.getHttpServer();
    const offered = await matching.startForReadyOrder(orderId);
    expect(offered.offered).toBe(true);
    expect(offered.assignment?.driverId).toBe(fixture.driverId);
    const accepted = await request(server)
      .post(`/api/v1/driver/assignments/${offered.assignment!.id}/accept`)
      .set('Authorization', `Bearer ${fixture.driverToken}`)
      .send({});
    expect(accepted.status).toBe(200);
    const acceptedBody = accepted.body as AcceptedBody;
    expect(acceptedBody.driverRemunerationMinor).toBe(300);
    for (const action of LOGISTICS_ACTIONS) {
      if (action === 'arrive-pickup' || action === 'arrive-customer') {
        await locations.upsert(
          fixture.driverId,
          36.7504,
          3.0504,
          new Date().toISOString(),
        );
      }
      const step = await request(server)
        .post(`/api/v1/driver/deliveries/current/${action}`)
        .set('Authorization', `Bearer ${fixture.driverToken}`)
        .send({});
      expect(step.status).toBe(200);
    }
    return acceptedBody;
  }

  async function completeElectronicDelivery(
    fixture: Fixture,
  ): Promise<{ orderId: string; deliveryId: string; paidMinor: number }> {
    const server = app.getHttpServer();
    const orderId = await createReadyOrder(fixture, 'ELECTRONIC');
    const accepted = await acceptAndArrive(fixture, orderId);
    const completed = await request(server)
      .post('/api/v1/driver/deliveries/current/complete-delivery')
      .set('Authorization', `Bearer ${fixture.driverToken}`)
      .send({});
    expect(completed.status).toBe(200);
    const payment = await prisma
      .getDb()
      .orm.public.Payment.where({ orderId })
      .first();
    expect(payment?.status).toBe('SUCCEEDED');
    return {
      orderId,
      deliveryId: accepted.deliveryId,
      paidMinor: Number(payment!.amountMinor),
    };
  }

  it('refunds a completed ELECTRONIC Order without mutating payment/order/earning/settlement', async () => {
    const suffix = Date.now().toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix, false);
      const server = app.getHttpServer();
      const { orderId, deliveryId, paidMinor } =
        await completeElectronicDelivery(fixture);
      const snapshotBefore = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({ orderId })
        .first();
      const earningBefore = await prisma
        .getDb()
        .orm.public.DriverEarning.where({ deliveryId })
        .first();
      expect(earningBefore?.status).toBe('EARNED');

      const partialAmount = Math.min(500, paidMinor - 1);
      const created = await refunds.createRefund({
        orderId,
        amountMinor: partialAmount,
        reason: 'partial goodwill',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: fixture.adminId,
      });
      expect(created.status).toBe('REQUESTED');
      await refunds.authorizeRefund(created.id, { adminId: fixture.adminId });
      const confirmed = await refunds.confirmManualRefund(created.id, {
        adminId: fixture.adminId,
        internalNote: 'bank transfer confirmed',
      });
      expect(confirmed.status).toBe('REFUNDED');
      expect(confirmed.completedAt).not.toBeNull();

      const paymentAfter = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId })
        .first();
      expect(paymentAfter?.status).toBe('SUCCEEDED');
      expect(Number(paymentAfter?.amountMinor)).toBe(paidMinor);

      const orderAfter = await prisma
        .getDb()
        .orm.public.Order.where({ id: orderId })
        .first();
      expect(orderAfter?.status).toBe('COMPLETED');

      const snapshotAfter = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({ orderId })
        .first();
      expect(Number(snapshotAfter?.customerPayableMinor)).toBe(
        Number(snapshotBefore?.customerPayableMinor),
      );
      expect(Number(snapshotAfter?.merchantCommissionAmountMinor)).toBe(
        Number(snapshotBefore?.merchantCommissionAmountMinor),
      );

      const earningAfter = await prisma
        .getDb()
        .orm.public.DriverEarning.where({ deliveryId })
        .first();
      expect(earningAfter?.id).toBe(earningBefore?.id);
      expect(earningAfter?.status).toBe('EARNED');
      expect(Number(earningAfter?.netEarningMinor)).toBe(
        Number(earningBefore?.netEarningMinor),
      );

      expect(
        await prisma
          .getDb()
          .orm.public.MerchantSettlement.where({
            merchantId: fixture.merchantId,
          })
          .all(),
      ).toHaveLength(0);
      expect(
        await prisma
          .getDb()
          .orm.public.MerchantSettlementLine.where({ orderId })
          .all(),
      ).toHaveLength(0);

      const listed = await request(server)
        .get(`/api/v1/customer/orders/${orderId}/refunds`)
        .set('Authorization', `Bearer ${fixture.customerToken}`);
      expect(listed.status).toBe(200);
      const body = listed.body as RefundsBody;
      expect(body.originalPaidMinor).toBe(paidMinor);
      expect(body.successfulRefundMinor).toBe(partialAmount);
      expect(body.remainingRefundableMinor).toBe(paidMinor - partialAmount);
      expect(body.refunds).toHaveLength(1);
      expect(body.refunds[0]?.status).toBe('REFUNDED');

      const full = await refunds.createRefund({
        orderId,
        amountMinor: paidMinor - partialAmount,
        reason: 'remainder',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: fixture.adminId,
      });
      await refunds.authorizeRefund(full.id, { adminId: fixture.adminId });
      await refunds.confirmManualRefund(full.id, { adminId: fixture.adminId });
      const capacity = await refunds.getCapacity(orderId);
      expect(capacity.remainingRefundableMinor).toBe(0);
      await expect(
        refunds.createRefund({
          orderId,
          amountMinor: 1,
          reason: 'blocked',
          refundMethod: REFUND_METHOD_MANUAL_OTHER,
          requestedByAdminId: fixture.adminId,
        }),
      ).rejects.toMatchObject({
        code: REFUND_ERROR_CODES.REFUND_INSUFFICIENT_REMAINING,
      });
      expect(
        (await prisma.getDb().orm.public.Payment.where({ orderId }).first())
          ?.status,
      ).toBe('SUCCEEDED');
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('keeps COD history and DriverEarning intact after MANUAL_COD refund', async () => {
    const suffix = `${Date.now().toString().slice(-5)}1`;
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix, false);
      const server = app.getHttpServer();
      const orderId = await createReadyOrder(fixture, 'COD');
      const accepted = await acceptAndArrive(fixture, orderId);
      const payment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId })
        .first();
      const collectedAmountMinor = Number(payment!.amountMinor);
      const collected = await request(server)
        .post('/api/v1/driver/deliveries/current/collect-cod')
        .set('Authorization', `Bearer ${fixture.driverToken}`)
        .send({ collectedAmountMinor });
      expect(collected.status).toBe(200);
      const completed = await request(server)
        .post('/api/v1/driver/deliveries/current/complete-delivery')
        .set('Authorization', `Bearer ${fixture.driverToken}`)
        .send({});
      expect(completed.status).toBe(200);

      const collectionBefore = await prisma
        .getDb()
        .orm.public.CodCollection.where({ orderId })
        .first();
      expect(collectionBefore).not.toBeNull();
      const earningBefore = await prisma
        .getDb()
        .orm.public.DriverEarning.where({
          deliveryId: accepted.deliveryId,
        })
        .first();

      const remittance = await request(server)
        .post('/api/v1/driver/cod/remittances')
        .set('Authorization', `Bearer ${fixture.driverToken}`)
        .send({ submittedAmountMinor: 500 });
      expect(remittance.status).toBe(200);

      const created = await refunds.createRefund({
        orderId,
        amountMinor: 400,
        reason: 'cod refund',
        refundMethod: REFUND_METHOD_MANUAL_COD,
        requestedByAdminId: fixture.adminId,
      });
      await refunds.authorizeRefund(created.id, { adminId: fixture.adminId });
      await refunds.confirmManualRefund(created.id, {
        adminId: fixture.adminId,
      });

      const collectionAfter = await prisma
        .getDb()
        .orm.public.CodCollection.where({ orderId })
        .first();
      expect(collectionAfter?.id).toBe(collectionBefore?.id);
      expect(Number(collectionAfter?.collectedAmountMinor)).toBe(
        Number(collectionBefore?.collectedAmountMinor),
      );
      expect(collectionAfter?.status).toBe(collectionBefore?.status);

      const remittanceAfter = await prisma
        .getDb()
        .orm.public.CodRemittance.where({
          id: (remittance.body as { remittanceId: string }).remittanceId,
        })
        .first();
      expect(remittanceAfter?.status).toBe('DECLARED');
      expect(Number(remittanceAfter?.submittedAmountMinor)).toBe(500);

      const earningAfter = await prisma
        .getDb()
        .orm.public.DriverEarning.where({
          deliveryId: accepted.deliveryId,
        })
        .first();
      expect(earningAfter?.id).toBe(earningBefore?.id);
      expect(earningAfter?.status).toBe('EARNED');
      expect(
        await prisma
          .getDb()
          .orm.public.MerchantSettlementLine.where({ orderId })
          .all(),
      ).toHaveLength(0);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('supports multiple partial refunds, concurrency, and Customer IDOR', async () => {
    const suffix = `${Date.now().toString().slice(-5)}2`;
    let fixture: Fixture | undefined;
    let foreignCustomerPhone: string | undefined;
    try {
      fixture = await createFixture(suffix, false);
      const server = app.getHttpServer();
      const { orderId, paidMinor } = await completeElectronicDelivery(fixture);
      expect(paidMinor).toBeGreaterThanOrEqual(1700);

      const a = await refunds.createRefund({
        orderId,
        amountMinor: 200,
        reason: 'a',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: fixture.adminId,
      });
      const b = await refunds.createRefund({
        orderId,
        amountMinor: 300,
        reason: 'b',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: fixture.adminId,
      });
      expect(a.status).toBe('REQUESTED');
      expect(b.status).toBe('REQUESTED');
      let capacity = await refunds.getCapacity(orderId);
      expect(capacity.reservedRefundMinor).toBe(500);
      expect(capacity.remainingRefundableMinor).toBe(paidMinor - 500);

      await expect(
        refunds.createRefund({
          orderId,
          amountMinor: paidMinor,
          reason: 'too much',
          refundMethod: REFUND_METHOD_MANUAL_OTHER,
          requestedByAdminId: fixture.adminId,
        }),
      ).rejects.toMatchObject({
        code: REFUND_ERROR_CODES.REFUND_INSUFFICIENT_REMAINING,
      });

      const parallelOrderId = (await completeElectronicDelivery(fixture))
        .orderId;
      const parallelPaid = Number(
        (
          await prisma
            .getDb()
            .orm.public.Payment.where({ orderId: parallelOrderId })
            .first()
        )?.amountMinor,
      );
      const target = Math.floor((parallelPaid * 7) / 10);
      const results = await Promise.allSettled([
        refunds.createRefund({
          orderId: parallelOrderId,
          amountMinor: target,
          reason: 'race-a',
          refundMethod: REFUND_METHOD_MANUAL_OTHER,
          requestedByAdminId: fixture.adminId,
        }),
        refunds.createRefund({
          orderId: parallelOrderId,
          amountMinor: target,
          reason: 'race-b',
          refundMethod: REFUND_METHOD_MANUAL_OTHER,
          requestedByAdminId: fixture.adminId,
        }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      capacity = await refunds.getCapacity(parallelOrderId);
      expect(capacity.reservedRefundMinor).toBe(target);
      expect(capacity.reservedRefundMinor).toBeLessThanOrEqual(parallelPaid);

      const own = await request(server)
        .get(`/api/v1/customer/orders/${orderId}/refunds`)
        .set('Authorization', `Bearer ${fixture.customerToken}`);
      expect(own.status).toBe(200);
      expect((own.body as RefundsBody).refunds.length).toBeGreaterThanOrEqual(
        2,
      );

      foreignCustomerPhone = `0579${suffix}`;
      const foreignToken = await authenticate(foreignCustomerPhone);
      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${foreignToken}`)
        .send({ fullName: 'Foreign Refund Customer' });
      const foreign = await request(server)
        .get(`/api/v1/customer/orders/${orderId}/refunds`)
        .set('Authorization', `Bearer ${foreignToken}`);
      expect(foreign.status).toBe(404);

      const merchantDenied = await request(server)
        .get(`/api/v1/customer/orders/${orderId}/refunds`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`);
      expect(merchantDenied.status).toBe(404);

      const driverDenied = await request(server)
        .get(`/api/v1/customer/orders/${orderId}/refunds`)
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect(driverDenied.status).toBe(404);
    } finally {
      if (foreignCustomerPhone) {
        await cleanupByPhone(foreignCustomerPhone);
      }
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('blocks ACTIVE Order refunds, ORIGINAL_PAYMENT, and releases rejected capacity', async () => {
    const suffix = `${Date.now().toString().slice(-5)}3`;
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix, false);
      const server = app.getHttpServer();

      const { orderId, paidMinor } = await completeElectronicDelivery(fixture);
      await expect(
        refunds.createRefund({
          orderId,
          amountMinor: 100,
          reason: 'original',
          refundMethod: REFUND_METHOD_ORIGINAL_PAYMENT,
          requestedByAdminId: fixture.adminId,
        }),
      ).rejects.toMatchObject({
        code: REFUND_ERROR_CODES.REFUND_PROVIDER_UNSUPPORTED,
      });
      expect(
        await prisma.getDb().orm.public.Refund.where({ orderId }).all(),
      ).toHaveLength(0);
      expect(() => refunds.attemptProviderRefund('noop')).toThrow();

      const reserved = await refunds.createRefund({
        orderId,
        amountMinor: Math.min(700, paidMinor),
        reason: 'to-reject',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: fixture.adminId,
      });
      await refunds.rejectRefund(reserved.id, { adminId: fixture.adminId });
      const capacity = await refunds.getCapacity(orderId);
      expect(capacity.remainingRefundableMinor).toBe(paidMinor);
      const reused = await refunds.createRefund({
        orderId,
        amountMinor: Math.min(700, paidMinor),
        reason: 'reuse-capacity',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: fixture.adminId,
      });
      expect(reused.status).toBe('REQUESTED');

      const listed = await request(server)
        .get(`/api/v1/customer/orders/${orderId}/refunds`)
        .set('Authorization', `Bearer ${fixture.customerToken}`);
      expect(listed.status).toBe(200);
      const body = listed.body as RefundsBody & {
        refunds: Array<Record<string, unknown>>;
      };
      for (const item of body.refunds) {
        expect(item.internalNote).toBeUndefined();
        expect(item.requestedByAdminId).toBeUndefined();
        expect(item.requestedAt).toBeDefined();
      }

      // Leave ACTIVE last so matching is not blocked for the completed Order above.
      const activeOrderId = await createReadyOrder(fixture, 'ELECTRONIC');
      const activeOrder = await prisma
        .getDb()
        .orm.public.Order.where({ id: activeOrderId })
        .first();
      expect(activeOrder?.status).toBe('ACTIVE');
      await expect(
        refunds.createRefund({
          orderId: activeOrderId,
          amountMinor: 100,
          reason: 'active blocked',
          refundMethod: REFUND_METHOD_MANUAL_OTHER,
          requestedByAdminId: fixture.adminId,
        }),
      ).rejects.toMatchObject({
        code: REFUND_ERROR_CODES.REFUND_ORDER_NOT_ELIGIBLE,
      });
      expect(
        await prisma
          .getDb()
          .orm.public.Refund.where({ orderId: activeOrderId })
          .all(),
      ).toHaveLength(0);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });
});
