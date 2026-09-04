import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
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
import { DriverReviewService } from '../src/modules/drivers/application/driver-review.service';
import { MatchingService } from '../src/modules/matching/application/matching.service';
import { MATCHING_QUEUE_NAME } from '../src/modules/matching/domain/matching.jobs';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '../src/modules/matching/domain/matching.types';
import { MatchingProcessor } from '../src/modules/matching/infrastructure/matching.processor';
import { MerchantSettlementService } from '../src/modules/merchant-settlements/application/merchant-settlement.service';
import { RefundService } from '../src/modules/refunds/application/refund.service';
import {
  REFUND_METHOD_MANUAL_COD,
  REFUND_METHOD_MANUAL_OTHER,
} from '../src/modules/refunds/domain/refund.types';

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

describe('Merchant Settlements Foundation (e2e)', () => {
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
  let settlements: MerchantSettlementService;

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
    matching = app.get(MatchingService);
    review = app.get(DriverReviewService);
    locations = app.get(DRIVER_LOCATION_STORE);
    queue = app.get<Queue>(getQueueToken(MATCHING_QUEUE_NAME));
    refunds = app.get(RefundService);
    settlements = app.get(MerchantSettlementService);

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
        deviceName: 'settlements-e2e',
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

  async function cleanupSettlementsForMerchant(
    merchantId: string,
  ): Promise<void> {
    const db = prisma.getDb().orm.public;
    for (const settlement of await db.MerchantSettlement.where({
      merchantId,
    }).all()) {
      for (const line of await db.MerchantSettlementLine.where({
        settlementId: settlement.id,
      }).all()) {
        await db.MerchantSettlementLine.where({ id: line.id }).delete();
      }
      await db.MerchantSettlement.where({ id: settlement.id }).delete();
    }
  }

  async function cleanupByPhone(phoneE164: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    const account = await db.Account.where({ phone: phoneE164 }).first();
    if (!account) return;

    const memberships = await db.MerchantMember.where({
      accountId: account.id,
    }).all();
    for (const merchantId of [
      ...new Set(memberships.map((row) => row.merchantId)),
    ]) {
      await cleanupSettlementsForMerchant(merchantId);
    }

    const driver = await db.DriverProfile.where({
      accountId: account.id,
    }).first();
    if (driver) {
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
      await db.DriverProfile.where({ id: driver.id }).delete();
    }

    const customer = await db.CustomerProfile.where({
      accountId: account.id,
    }).first();
    if (customer) {
      const orders = await db.Order.where({ customerId: customer.id }).all();
      for (const order of orders) {
        for (const line of await db.MerchantSettlementLine.where({
          orderId: order.id,
        }).all()) {
          await db.MerchantSettlementLine.where({ id: line.id }).delete();
        }
        const delivery = await db.Delivery.where({ orderId: order.id }).first();
        if (delivery) {
          const proof = await db.DeliveryProof.where({
            deliveryId: delivery.id,
          }).first();
          if (proof) {
            await db.DeliveryProof.where({ id: proof.id }).delete();
          }
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

    for (const merchantId of [
      ...new Set(memberships.map((row) => row.merchantId)),
    ]) {
      await cleanupSettlementsForMerchant(merchantId);
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
    await db.Account.where({ id: account.id }).delete();
  }

  type Fixture = {
    suffix: string;
    customerToken: string;
    ownerToken: string;
    managerToken: string;
    staffToken: string;
    driverToken: string;
    foreignOwnerToken: string;
    driverId: string;
    merchantId: string;
    foreignMerchantId: string;
    productId: string;
    addressId: string;
    phones: string[];
    zoneId: string;
    adminId: string;
    roleId: string;
  };

  async function createFixture(suffix: string): Promise<Fixture> {
    const server = app.getHttpServer();
    const rawPhones = [
      `0581${suffix}`,
      `0582${suffix}`,
      `0583${suffix}`,
      `0584${suffix}`,
      `0585${suffix}`,
      `0586${suffix}`,
    ];
    const tokens: string[] = [];
    for (const phone of rawPhones) {
      tokens.push(await authenticate(phone));
    }
    const [
      customerToken,
      ownerToken,
      managerToken,
      staffToken,
      driverToken,
      foreignOwnerToken,
    ] = tokens;
    const accounts = await Promise.all(tokens.map(authMe));

    await request(server)
      .post('/api/v1/customer/profile')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'Settlement Customer' });
    const address = await request(server)
      .post('/api/v1/customer/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        label: 'Home',
        addressText: 'Settlement dropoff',
        latitude: INSIDE[0],
        longitude: INSIDE[1],
      });
    expect(address.status).toBe(201);

    const merchant = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Settlement Cafe ${suffix}` });
    const merchantId = (merchant.body as { merchantId: string }).merchantId;
    const branch = await request(server)
      .post(`/api/v1/merchant/${merchantId}/branches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Main',
        phone: `0560${suffix}`,
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

    await prisma.getDb().orm.public.MerchantMember.create({
      id: createUuidV7(),
      merchantId,
      accountId: accounts[2].id,
      role: pgVarchar<64>('MANAGER'),
      createdAt: pgNow(),
    });
    await prisma.getDb().orm.public.MerchantMember.create({
      id: createUuidV7(),
      merchantId,
      accountId: accounts[3].id,
      role: pgVarchar<64>('STAFF'),
      createdAt: pgNow(),
    });

    const foreign = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .send({ name: `Foreign Settlement ${suffix}` });
    const foreignMerchantId = (foreign.body as { merchantId: string })
      .merchantId;
    await prisma
      .getDb()
      .orm.public.Merchant.where({ id: foreignMerchantId })
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
        name: 'Settlement meal',
        priceMinor: 10000,
      });

    const now = pgNow();
    const zoneId = createUuidV7();
    await prisma.getDb().orm.public.DeliveryZone.create({
      id: zoneId,
      name: pgVarchar<255>(`Settlement zone ${suffix}`),
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
      name: pgVarchar<128>(`settlement-e2e-${suffix}`),
      description: null,
      active: true,
    });
    const adminId = createUuidV7();
    await prisma.getDb().orm.public.AdminProfile.create({
      id: adminId,
      accountId: accounts[1].id,
      roleId,
      displayName: pgVarchar<255>('Settlement Admin'),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
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
      'Settlement Driver',
      `ST${suffix}`,
    );
    await locations.upsert(driverId, 36.7504, 3.0504, new Date().toISOString());

    return {
      suffix,
      customerToken,
      ownerToken,
      managerToken,
      staffToken,
      driverToken,
      foreignOwnerToken,
      driverId,
      merchantId,
      foreignMerchantId,
      productId: (product.body as { id: string }).id,
      addressId: (address.body as { id: string }).id,
      phones: accounts.map((account) => account.phone),
      zoneId,
      adminId,
      roleId,
    };
  }

  async function cleanupFixture(fixture: Fixture): Promise<void> {
    await cleanupSettlementsForMerchant(fixture.merchantId);
    await cleanupSettlementsForMerchant(fixture.foreignMerchantId);
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
    const accepted = await request(server)
      .post(`/api/v1/driver/assignments/${offered.assignment!.id}/accept`)
      .set('Authorization', `Bearer ${fixture.driverToken}`)
      .send({});
    expect(accepted.status).toBe(200);
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
    return accepted.body as AcceptedBody;
  }

  async function completeElectronic(
    fixture: Fixture,
  ): Promise<{ orderId: string; deliveryId: string; merchantNet: number }> {
    const server = app.getHttpServer();
    const orderId = await createReadyOrder(fixture, 'ELECTRONIC');
    const accepted = await acceptAndArrive(fixture, orderId);
    const completed = await request(server)
      .post('/api/v1/driver/deliveries/current/complete-delivery')
      .set('Authorization', `Bearer ${fixture.driverToken}`)
      .send({});
    expect(completed.status).toBe(200);
    const snapshot = await prisma
      .getDb()
      .orm.public.OrderFinancialSnapshot.where({ orderId })
      .first();
    return {
      orderId,
      deliveryId: accepted.deliveryId,
      merchantNet: Number(snapshot!.merchantNetAmountMinor),
    };
  }

  async function completeCod(
    fixture: Fixture,
  ): Promise<{ orderId: string; deliveryId: string; merchantNet: number }> {
    const server = app.getHttpServer();
    const orderId = await createReadyOrder(fixture, 'COD');
    const accepted = await acceptAndArrive(fixture, orderId);
    const payment = await prisma
      .getDb()
      .orm.public.Payment.where({ orderId })
      .first();
    const collected = await request(server)
      .post('/api/v1/driver/deliveries/current/collect-cod')
      .set('Authorization', `Bearer ${fixture.driverToken}`)
      .send({ collectedAmountMinor: Number(payment!.amountMinor) });
    expect(collected.status).toBe(200);
    const completed = await request(server)
      .post('/api/v1/driver/deliveries/current/complete-delivery')
      .set('Authorization', `Bearer ${fixture.driverToken}`)
      .send({});
    expect(completed.status).toBe(200);
    const snapshot = await prisma
      .getDb()
      .orm.public.OrderFinancialSnapshot.where({ orderId })
      .first();
    return {
      orderId,
      deliveryId: accepted.deliveryId,
      merchantNet: Number(snapshot!.merchantNetAmountMinor),
    };
  }

  function widePeriod(): { periodStart: string; periodEnd: string } {
    return {
      periodStart: '2020-01-01T00:00:00.000Z',
      periodEnd: '2099-01-01T00:00:00.000Z',
    };
  }

  it('settles ELECTRONIC SALE from immutable merchant net without payout side effects', async () => {
    const suffix = Date.now().toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const { orderId, deliveryId, merchantNet } =
        await completeElectronic(fixture);
      const earningBefore = await prisma
        .getDb()
        .orm.public.DriverEarning.where({ deliveryId })
        .first();
      expect(earningBefore?.status).toBe('EARNED');

      const draft = await settlements.openDraft({
        merchantId: fixture.merchantId,
        ...widePeriod(),
        adminId: fixture.adminId,
      });
      const built = await settlements.buildSaleLines({
        settlementId: draft.id,
        adminId: fixture.adminId,
      });
      expect(built.added).toBe(1);
      const rebuilt = await settlements.buildSaleLines({
        settlementId: draft.id,
        adminId: fixture.adminId,
      });
      expect(rebuilt.added).toBe(0);

      const finalized = await settlements.finalize({
        settlementId: draft.id,
        adminId: fixture.adminId,
      });
      expect(finalized.status).toBe('FINALIZED');
      expect(finalized.paidAt).toBeNull();
      expect(finalized.netPayableMinor).toBe(merchantNet);

      const lines = await prisma
        .getDb()
        .orm.public.MerchantSettlementLine.where({ orderId })
        .all();
      expect(lines).toHaveLength(1);
      expect(lines[0]?.type).toBe('SALE');
      expect(Number(lines[0]?.merchantNetMinor)).toBe(merchantNet);

      const earningAfter = await prisma
        .getDb()
        .orm.public.DriverEarning.where({ deliveryId })
        .first();
      expect(earningAfter?.id).toBe(earningBefore?.id);
      expect(Number(earningAfter?.netEarningMinor)).toBe(
        Number(earningBefore?.netEarningMinor),
      );
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('settles COD SALE with outstanding custody unchanged', async () => {
    const suffix = (Date.now() + 1).toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const { orderId, merchantNet } = await completeCod(fixture);
      const collectionBefore = await prisma
        .getDb()
        .orm.public.CodCollection.where({ orderId })
        .first();
      expect(collectionBefore).toBeTruthy();

      const draft = await settlements.openDraft({
        merchantId: fixture.merchantId,
        ...widePeriod(),
        adminId: fixture.adminId,
      });
      await settlements.buildSaleLines({
        settlementId: draft.id,
        adminId: fixture.adminId,
      });
      const finalized = await settlements.finalize({
        settlementId: draft.id,
        adminId: fixture.adminId,
      });
      expect(finalized.netPayableMinor).toBe(merchantNet);

      const collectionAfter = await prisma
        .getDb()
        .orm.public.CodCollection.where({ orderId })
        .first();
      expect(collectionAfter?.id).toBe(collectionBefore?.id);
      expect(Number(collectionAfter?.collectedAmountMinor)).toBe(
        Number(collectionBefore?.collectedAmountMinor),
      );
      expect(
        await prisma
          .getDb()
          .orm.public.CodRemittance.where({ driverId: fixture.driverId })
          .all(),
      ).toHaveLength(0);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('applies trusted partial Merchant liability and keeps Refund/DriverEarning immutable', async () => {
    const suffix = (Date.now() + 2).toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const { orderId, deliveryId, merchantNet } =
        await completeElectronic(fixture);
      const draft = await settlements.openDraft({
        merchantId: fixture.merchantId,
        ...widePeriod(),
        adminId: fixture.adminId,
      });
      await settlements.buildSaleLines({
        settlementId: draft.id,
        adminId: fixture.adminId,
      });

      const created = await refunds.createRefund({
        orderId,
        amountMinor: 4000,
        reason: 'partial goodwill',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: fixture.adminId,
      });
      await refunds.authorizeRefund(created.id, { adminId: fixture.adminId });
      const confirmed = await refunds.confirmManualRefund(created.id, {
        adminId: fixture.adminId,
      });
      expect(confirmed.status).toBe('REFUNDED');

      const adj = await settlements.attachRefundAdjustment({
        settlementId: draft.id,
        refundId: confirmed.id,
        merchantLiabilityMinor: 2500,
        adminId: fixture.adminId,
      });
      expect(adj?.adjustmentMinor).toBe(-2500);

      const finalized = await settlements.finalize({
        settlementId: draft.id,
        adminId: fixture.adminId,
      });
      expect(finalized.netPayableMinor).toBe(merchantNet - 2500);
      expect(finalized.refundAdjustmentsMinor).toBe(-2500);

      const refundAfter = await prisma
        .getDb()
        .orm.public.Refund.where({ id: confirmed.id })
        .first();
      expect(refundAfter?.status).toBe('REFUNDED');
      expect(Number(refundAfter?.amountMinor)).toBe(4000);

      const earning = await prisma
        .getDb()
        .orm.public.DriverEarning.where({ deliveryId })
        .first();
      expect(earning?.status).toBe('EARNED');
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('places refund adjustment after finalized SALE into a later settlement', async () => {
    const suffix = (Date.now() + 3).toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const { orderId, merchantNet } = await completeElectronic(fixture);
      await prisma
        .getDb()
        .orm.public.Order.where({ id: orderId })
        .update({ completedAt: pgTimestamptz('2025-06-15T12:00:00.000Z') });

      const a = await settlements.openDraft({
        merchantId: fixture.merchantId,
        periodStart: '2025-06-01T00:00:00.000Z',
        periodEnd: '2025-07-01T00:00:00.000Z',
        adminId: fixture.adminId,
      });
      await settlements.buildSaleLines({
        settlementId: a.id,
        adminId: fixture.adminId,
      });
      const finalizedA = await settlements.finalize({
        settlementId: a.id,
        adminId: fixture.adminId,
      });
      expect(finalizedA.netPayableMinor).toBe(merchantNet);

      const created = await refunds.createRefund({
        orderId,
        amountMinor: 1000,
        reason: 'post settlement',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: fixture.adminId,
      });
      await refunds.authorizeRefund(created.id, { adminId: fixture.adminId });
      const confirmed = await refunds.confirmManualRefund(created.id, {
        adminId: fixture.adminId,
      });

      const b = await settlements.openDraft({
        merchantId: fixture.merchantId,
        ...widePeriod(),
        adminId: fixture.adminId,
      });
      await settlements.attachRefundAdjustment({
        settlementId: b.id,
        refundId: confirmed.id,
        merchantLiabilityMinor: 1000,
        adminId: fixture.adminId,
      });
      const finalizedB = await settlements.finalize({
        settlementId: b.id,
        adminId: fixture.adminId,
      });
      expect(finalizedB.netPayableMinor).toBe(-1000);

      const aAfter = await prisma
        .getDb()
        .orm.public.MerchantSettlement.where({ id: a.id })
        .first();
      expect(aAfter?.status).toBe('FINALIZED');
      expect(Number(aAfter?.netPayableMinor)).toBe(merchantNet);
      expect(
        await prisma
          .getDb()
          .orm.public.MerchantSettlementLine.where({ settlementId: a.id })
          .all(),
      ).toHaveLength(1);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('creates SALE + adjustment coherently when refund completes before batch', async () => {
    const suffix = (Date.now() + 4).toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const { orderId, merchantNet } = await completeElectronic(fixture);
      const created = await refunds.createRefund({
        orderId,
        amountMinor: 1500,
        reason: 'before batch',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: fixture.adminId,
      });
      await refunds.authorizeRefund(created.id, { adminId: fixture.adminId });
      const confirmed = await refunds.confirmManualRefund(created.id, {
        adminId: fixture.adminId,
      });

      const draft = await settlements.openDraft({
        merchantId: fixture.merchantId,
        ...widePeriod(),
        adminId: fixture.adminId,
      });
      const adj = await settlements.attachRefundAdjustment({
        settlementId: draft.id,
        refundId: confirmed.id,
        merchantLiabilityMinor: 1500,
        adminId: fixture.adminId,
      });
      expect(adj?.type).toBe('REFUND_ADJUSTMENT');
      const lines = await prisma
        .getDb()
        .orm.public.MerchantSettlementLine.where({ settlementId: draft.id })
        .all();
      expect(lines.some((line) => line.type === 'SALE')).toBe(true);
      expect(lines.some((line) => line.type === 'REFUND_ADJUSTMENT')).toBe(
        true,
      );
      const finalized = await settlements.finalize({
        settlementId: draft.id,
        adminId: fixture.adminId,
      });
      expect(finalized.netPayableMinor).toBe(merchantNet - 1500);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('enforces Merchant read roles and foreign isolation', async () => {
    const suffix = (Date.now() + 5).toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      await completeElectronic(fixture);
      const draft = await settlements.openDraft({
        merchantId: fixture.merchantId,
        ...widePeriod(),
        adminId: fixture.adminId,
      });
      await settlements.buildSaleLines({
        settlementId: draft.id,
        adminId: fixture.adminId,
      });
      await settlements.finalize({
        settlementId: draft.id,
        adminId: fixture.adminId,
      });

      const server = app.getHttpServer();
      const ownerList = await request(server)
        .get(`/api/v1/merchant/${fixture.merchantId}/settlements`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`);
      expect(ownerList.status).toBe(200);
      expect(ownerList.body).toHaveLength(1);

      const managerList = await request(server)
        .get(`/api/v1/merchant/${fixture.merchantId}/settlements`)
        .set('Authorization', `Bearer ${fixture.managerToken}`);
      expect(managerList.status).toBe(200);

      const staffList = await request(server)
        .get(`/api/v1/merchant/${fixture.merchantId}/settlements`)
        .set('Authorization', `Bearer ${fixture.staffToken}`);
      expect(staffList.status).toBe(403);

      const foreign = await request(server)
        .get(`/api/v1/merchant/${fixture.merchantId}/settlements`)
        .set('Authorization', `Bearer ${fixture.foreignOwnerToken}`);
      expect([403, 404]).toContain(foreign.status);

      const customer = await request(server)
        .get(`/api/v1/merchant/${fixture.merchantId}/settlements`)
        .set('Authorization', `Bearer ${fixture.customerToken}`);
      expect([403, 404]).toContain(customer.status);

      const driver = await request(server)
        .get(`/api/v1/merchant/${fixture.merchantId}/settlements`)
        .set('Authorization', `Bearer ${fixture.driverToken}`);
      expect([403, 404]).toContain(driver.status);

      const detail = await request(server)
        .get(`/api/v1/merchant/${fixture.merchantId}/settlements/${draft.id}`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`);
      expect(detail.status).toBe(200);
      const detailBody = detail.body as {
        settlementId: string;
        status: string;
        currency: string;
        paidAt?: unknown;
      };
      expect(detailBody).toMatchObject({
        settlementId: draft.id,
        status: 'FINALIZED',
        currency: 'DZD',
      });
      expect(detailBody.paidAt).toBeUndefined();
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('does not require COD remittance for SALE and keeps COD method path intact', async () => {
    const suffix = (Date.now() + 6).toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const { orderId } = await completeCod(fixture);
      const created = await refunds.createRefund({
        orderId,
        amountMinor: 500,
        reason: 'cod goodwill',
        refundMethod: REFUND_METHOD_MANUAL_COD,
        requestedByAdminId: fixture.adminId,
      });
      await refunds.authorizeRefund(created.id, { adminId: fixture.adminId });
      await refunds.confirmManualRefund(created.id, {
        adminId: fixture.adminId,
      });
      expect(
        await prisma
          .getDb()
          .orm.public.CodRemittance.where({ driverId: fixture.driverId })
          .all(),
      ).toHaveLength(0);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });
});
