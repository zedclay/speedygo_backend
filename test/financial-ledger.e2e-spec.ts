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
import { CodFoundationService } from '../src/modules/cod/application/cod-foundation.service';
import { DriverReviewService } from '../src/modules/drivers/application/driver-review.service';
import { FinancialLedgerService } from '../src/modules/financial-ledger/application/financial-ledger.service';
import { MatchingService } from '../src/modules/matching/application/matching.service';
import { MATCHING_QUEUE_NAME } from '../src/modules/matching/domain/matching.jobs';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '../src/modules/matching/domain/matching.types';
import { MatchingProcessor } from '../src/modules/matching/infrastructure/matching.processor';
import { MerchantSettlementService } from '../src/modules/merchant-settlements/application/merchant-settlement.service';
import { RefundService } from '../src/modules/refunds/application/refund.service';
import { REFUND_METHOD_MANUAL_OTHER } from '../src/modules/refunds/domain/refund.types';

type TokenBody = { accessToken: string };
type AuthMeBody = { account: { id: string; phone: string } };
type PreviewBody = {
  merchandiseSubtotalMinor: number;
  deliveryFeeMinor: number;
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
const LOGISTICS_ACTIONS = [
  'start-to-pickup',
  'arrive-pickup',
  'confirm-pickup',
  'start-delivery',
  'arrive-customer',
] as const;

describe('Financial Ledger Foundation (e2e)', () => {
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
  let ledger: FinancialLedgerService;
  let cod: CodFoundationService;

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
    settlements = app.get(MerchantSettlementService);
    ledger = app.get(FinancialLedgerService);
    cod = app.get(CodFoundationService);

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
        deviceName: 'ledger-e2e',
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

  async function deleteLedgerForOrder(orderId: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    for (const row of await db.FinancialLedgerEntry.where({ orderId }).all()) {
      await db.FinancialLedgerEntry.where({ id: row.id }).delete();
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
      for (const settlement of await db.MerchantSettlement.where({
        merchantId,
      }).all()) {
        const entry = await db.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`MERCHANT_SETTLEMENT:${settlement.id}`),
        }).first();
        if (entry) {
          await db.FinancialLedgerEntry.where({ id: entry.id }).delete();
        }
        for (const line of await db.MerchantSettlementLine.where({
          settlementId: settlement.id,
        }).all()) {
          await db.MerchantSettlementLine.where({ id: line.id }).delete();
        }
        await db.MerchantSettlement.where({ id: settlement.id }).delete();
      }
      for (const entry of await db.FinancialLedgerEntry.where({
        merchantId,
      }).all()) {
        await db.FinancialLedgerEntry.where({ id: entry.id }).delete();
      }
    }

    const driver = await db.DriverProfile.where({
      accountId: account.id,
    }).first();
    if (driver) {
      for (const row of await db.FinancialLedgerEntry.where({
        driverId: driver.id,
      }).all()) {
        await db.FinancialLedgerEntry.where({ id: row.id }).delete();
      }
      for (const remittance of await db.CodRemittance.where({
        driverId: driver.id,
      }).all()) {
        const discrepancy = await db.CodDiscrepancy.where({
          remittanceId: remittance.id,
        }).first();
        if (discrepancy) {
          await db.CodDiscrepancy.where({ id: discrepancy.id }).delete();
        }
        for (const allocation of await db.CodRemittanceAllocation.where({
          remittanceId: remittance.id,
        }).all()) {
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
      for (const order of await db.Order.where({
        customerId: customer.id,
      }).all()) {
        await deleteLedgerForOrder(order.id);
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
          const entry = await db.FinancialLedgerEntry.where({
            reference: pgVarchar<128>(`REFUND:${refund.id}`),
          }).first();
          if (entry) {
            await db.FinancialLedgerEntry.where({ id: entry.id }).delete();
          }
          await db.Refund.where({ id: refund.id }).delete();
        }
        for (const payment of await db.Payment.where({
          orderId: order.id,
        }).all()) {
          const entry = await db.FinancialLedgerEntry.where({
            reference: pgVarchar<128>(`PAYMENT:${payment.id}`),
          }).first();
          if (entry) {
            await db.FinancialLedgerEntry.where({ id: entry.id }).delete();
          }
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
    driverId: string;
    merchantId: string;
    productId: string;
    addressId: string;
    phones: string[];
    zoneId: string;
    adminId: string;
    roleId: string;
  };

  async function createFixture(suffix: string): Promise<Fixture> {
    const server = app.getHttpServer();
    const rawPhones = [`0591${suffix}`, `0592${suffix}`, `0593${suffix}`];
    const tokens: string[] = [];
    for (const phone of rawPhones) {
      tokens.push(await authenticate(phone));
    }
    const [customerToken, ownerToken, driverToken] = tokens;
    const accounts = await Promise.all(tokens.map(authMe));

    await request(server)
      .post('/api/v1/customer/profile')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'Ledger Customer' });
    const address = await request(server)
      .post('/api/v1/customer/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        label: 'Home',
        addressText: 'Ledger dropoff',
        latitude: INSIDE[0],
        longitude: INSIDE[1],
      });
    expect(address.status).toBe(201);

    const merchant = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Ledger Cafe ${suffix}` });
    const merchantId = (merchant.body as { merchantId: string }).merchantId;
    const branch = await request(server)
      .post(`/api/v1/merchant/${merchantId}/branches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Main',
        phone: `0540${suffix}`,
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
        name: 'Ledger meal',
        priceMinor: 10000,
      });

    const now = pgNow();
    const zoneId = createUuidV7();
    await prisma.getDb().orm.public.DeliveryZone.create({
      id: zoneId,
      name: pgVarchar<255>(`Ledger zone ${suffix}`),
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
      name: pgVarchar<128>(`ledger-e2e-${suffix}`),
      description: null,
      active: true,
    });
    const adminId = createUuidV7();
    await prisma.getDb().orm.public.AdminProfile.create({
      id: adminId,
      accountId: accounts[1].id,
      roleId,
      displayName: pgVarchar<255>('Ledger Admin'),
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
      'Ledger Driver',
      `LG${suffix}`,
    );
    await locations.upsert(driverId, 36.7504, 3.0504, new Date().toISOString());

    return {
      suffix,
      customerToken,
      ownerToken,
      driverToken,
      driverId,
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
    await request(server)
      .post(
        `/api/v1/merchant/${fixture.merchantId}/orders/${orderId}/start-preparation`,
      )
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({});
    await request(server)
      .post(
        `/api/v1/merchant/${fixture.merchantId}/orders/${orderId}/mark-ready`,
      )
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({});
    return orderId;
  }

  async function completeLogistics(fixture: Fixture, orderId: string) {
    const server = app.getHttpServer();
    const offered = await matching.startForReadyOrder(orderId);
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
  }

  it('records ELECTRONIC payment + Driver payable + Merchant payable without payout/bank cash claim', async () => {
    const suffix = Date.now().toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const server = app.getHttpServer();
      const orderId = await createReadyOrder(fixture, 'ELECTRONIC');
      const payment = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId })
        .first();
      // Direct SUCCEEDED update bypasses webhook hook — reconciler recovers.
      await ledger.postElectronicPaymentSucceeded({
        paymentId: payment!.id,
        orderId,
        amountMinor: Number(payment!.amountMinor),
        currency: 'DZD',
      });
      await completeLogistics(fixture, orderId);
      const completed = await request(server)
        .post('/api/v1/driver/deliveries/current/complete-delivery')
        .set('Authorization', `Bearer ${fixture.driverToken}`)
        .send({});
      expect(completed.status).toBe(200);

      const snapshot = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({ orderId })
        .first();
      const draft = await settlements.openDraft({
        merchantId: fixture.merchantId,
        periodStart: '2020-01-01T00:00:00.000Z',
        periodEnd: '2099-01-01T00:00:00.000Z',
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

      const paymentEntries = await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`PAYMENT:${payment!.id}`),
        })
        .all();
      expect(paymentEntries).toHaveLength(1);
      expect(paymentEntries[0]?.type).toBe('CUSTOMER_PAYMENT');
      expect(paymentEntries[0]?.direction).toBe('DEBIT');

      const positions = await ledger.getDriverPositions(fixture.driverId);
      expect(positions.driverPayableMinor).toBe(300);
      expect(positions.codCustodyMinor).toBe(0);

      const merchantPos = await ledger.getMerchantPosition(fixture.merchantId);
      expect(merchantPos.netPayableMinor).toBe(
        Number(snapshot!.merchantNetAmountMinor),
      );
      expect(finalized.paidAt).toBeNull();

      const again = await ledger.reconcileUnposted(20);
      expect(again.posted).toBe(0);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('keeps COD custody and Driver payable un-netted; remittance reduces custody only', async () => {
    const suffix = (Date.now() + 1).toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const server = app.getHttpServer();
      const orderId = await createReadyOrder(fixture, 'COD');
      await completeLogistics(fixture, orderId);
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

      let positions = await ledger.getDriverPositions(fixture.driverId);
      expect(positions.codCustodyMinor).toBe(Number(payment!.amountMinor));
      expect(positions.driverPayableMinor).toBe(300);

      const remittance = await request(server)
        .post('/api/v1/driver/cod/remittances')
        .set('Authorization', `Bearer ${fixture.driverToken}`)
        .send({ submittedAmountMinor: 500 });
      expect(remittance.status).toBe(200);
      await cod.confirmCodRemittance(
        (remittance.body as { remittanceId: string }).remittanceId,
        500,
      );

      positions = await ledger.getDriverPositions(fixture.driverId);
      expect(positions.codCustodyMinor).toBe(
        Number(payment!.amountMinor) - 500,
      );
      expect(positions.driverPayableMinor).toBe(300);

      const customerPaymentLegs = await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({
          type: pgVarchar<64>('CUSTOMER_PAYMENT'),
          orderId,
        })
        .all();
      expect(customerPaymentLegs).toHaveLength(0);

      const remittanceRows = await prisma
        .getDb()
        .orm.public.CodRemittance.where({ driverId: fixture.driverId })
        .all();
      expect(remittanceRows).toHaveLength(1);
      const remittanceEntries = await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`COD_REMITTANCE:${remittanceRows[0].id}`),
        })
        .all();
      expect(remittanceEntries).toHaveLength(1);
      expect(remittanceEntries[0]?.type).toBe('COD_CUSTODY');
      expect(remittanceEntries[0]?.direction).toBe('CREDIT');
      expect(Number(remittanceEntries[0]?.amountMinor)).toBe(500);

      const allocations = await prisma
        .getDb()
        .orm.public.CodRemittanceAllocation.where({
          remittanceId: remittanceRows[0].id,
        })
        .all();
      expect(allocations.length).toBeGreaterThan(0);
      const custodyCredits = await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({
          driverId: fixture.driverId,
          type: pgVarchar<64>('COD_CUSTODY'),
          direction: 'CREDIT',
        })
        .all();
      expect(custodyCredits).toHaveLength(1);

      await ledger.reconcileUnposted(50);
      const remittanceAfter = await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`COD_REMITTANCE:${remittanceRows[0].id}`),
        })
        .all();
      expect(remittanceAfter).toHaveLength(1);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('posts Refund amount separately from Merchant settlement liability', async () => {
    const suffix = (Date.now() + 2).toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const server = app.getHttpServer();
      const orderId = await createReadyOrder(fixture, 'ELECTRONIC');
      await completeLogistics(fixture, orderId);
      await request(server)
        .post('/api/v1/driver/deliveries/current/complete-delivery')
        .set('Authorization', `Bearer ${fixture.driverToken}`)
        .send({});

      const created = await refunds.createRefund({
        orderId,
        amountMinor: 4000,
        reason: 'ledger partial',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: fixture.adminId,
      });
      await refunds.authorizeRefund(created.id, { adminId: fixture.adminId });
      await refunds.confirmManualRefund(created.id, {
        adminId: fixture.adminId,
      });

      const refundEntries = await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`REFUND:${created.id}`),
        })
        .all();
      expect(refundEntries).toHaveLength(1);
      expect(Number(refundEntries[0]?.amountMinor)).toBe(4000);

      const draft = await settlements.openDraft({
        merchantId: fixture.merchantId,
        periodStart: '2020-01-01T00:00:00.000Z',
        periodEnd: '2099-01-01T00:00:00.000Z',
        adminId: fixture.adminId,
      });
      await settlements.buildSaleLines({
        settlementId: draft.id,
        adminId: fixture.adminId,
      });
      await settlements.attachRefundAdjustment({
        settlementId: draft.id,
        refundId: created.id,
        merchantLiabilityMinor: 2500,
        adminId: fixture.adminId,
      });
      const finalized = await settlements.finalize({
        settlementId: draft.id,
        adminId: fixture.adminId,
      });

      const settlementEntries = await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`MERCHANT_SETTLEMENT:${finalized.id}`),
        })
        .all();
      expect(settlementEntries).toHaveLength(1);
      expect(Number(settlementEntries[0]?.amountMinor)).toBe(
        Math.abs(finalized.netPayableMinor),
      );
      expect(finalized.refundAdjustmentsMinor).toBe(-2500);
      await ledger.reconcileUnposted(50);
      const refundAfter = await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`REFUND:${created.id}`),
        })
        .all();
      expect(refundAfter).toHaveLength(1);
      const settlementAfter = await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`MERCHANT_SETTLEMENT:${finalized.id}`),
        })
        .all();
      expect(settlementAfter).toHaveLength(1);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('derives Merchant cumulative category-local position and posts zero sources idempotently', async () => {
    const suffix = (Date.now() + 3).toString().slice(-6);
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(suffix);
      const orderId = await createReadyOrder(fixture, 'ELECTRONIC');
      const negativeId = createUuidV7();
      const positiveId = createUuidV7();
      await ledger.postMerchantSettlementFinalized({
        settlementId: negativeId,
        merchantId: fixture.merchantId,
        netPayableMinor: -2000,
      });
      await ledger.postMerchantSettlementFinalized({
        settlementId: positiveId,
        merchantId: fixture.merchantId,
        netPayableMinor: 8000,
      });
      const position = await ledger.getMerchantPosition(fixture.merchantId);
      expect(position.netPayableMinor).toBe(6000);

      const zeroSettlementId = createUuidV7();
      const zeroEarningId = createUuidV7();
      await ledger.postMerchantSettlementFinalized({
        settlementId: zeroSettlementId,
        merchantId: fixture.merchantId,
        netPayableMinor: 0,
      });
      await ledger.postDriverEarning({
        earningId: zeroEarningId,
        orderId,
        driverId: fixture.driverId,
        netEarningMinor: 0,
      });

      const zeroSettlement = await ledger.getBySourceReference(
        `MERCHANT_SETTLEMENT:${zeroSettlementId}`,
      );
      expect(zeroSettlement?.direction).toBe('CREDIT');
      expect(zeroSettlement?.amountMinor).toBe(0);
      const zeroEarning = await ledger.getBySourceReference(
        `DRIVER_EARNING:${zeroEarningId}`,
      );
      expect(zeroEarning?.direction).toBe('CREDIT');
      expect(zeroEarning?.amountMinor).toBe(0);

      await ledger.postMerchantSettlementFinalized({
        settlementId: zeroSettlementId,
        merchantId: fixture.merchantId,
        netPayableMinor: 0,
      });
      await ledger.postDriverEarning({
        earningId: zeroEarningId,
        orderId,
        driverId: fixture.driverId,
        netEarningMinor: 0,
      });
      await ledger.reconcileUnposted(50);

      const settlementRefs = await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`MERCHANT_SETTLEMENT:${zeroSettlementId}`),
        })
        .all();
      expect(settlementRefs).toHaveLength(1);
      const earningRefs = await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`DRIVER_EARNING:${zeroEarningId}`),
        })
        .all();
      expect(earningRefs).toHaveLength(1);
      const negativeRefs = await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`MERCHANT_SETTLEMENT:${negativeId}`),
        })
        .all();
      expect(negativeRefs).toHaveLength(1);
      expect(negativeRefs[0]?.direction).toBe('DEBIT');
      const positiveRefs = await prisma
        .getDb()
        .orm.public.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`MERCHANT_SETTLEMENT:${positiveId}`),
        })
        .all();
      expect(positiveRefs).toHaveLength(1);
      expect(positiveRefs[0]?.direction).toBe('CREDIT');
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });
});
