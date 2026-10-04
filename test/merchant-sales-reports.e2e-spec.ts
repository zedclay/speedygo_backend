import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createUuidV7 } from '../src/common/utils/uuid-v7';
import { PrismaService } from '../src/infrastructure/database/database.module';
import {
  pgBigInt,
  pgChar,
  pgNow,
  pgTimestamptz,
  pgVarchar,
} from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { MERCHANT_REPORTS_CLOCK } from '../src/modules/reports/domain/merchant-sales-report.types';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';
import {
  deleteBranchOpeningHours,
  ensureBranchOpeningHours,
} from './helpers/ensure-branch-opening-hours';

type TokenBody = { accessToken: string };
type AuthMeBody = { account: { id: string; phone: string } };
type ErrorBody = { error: { code: string; message: string } };

type TrendBucket = {
  start: string;
  localStart: string;
  completedOrderCount: number;
  grossMerchandiseMinor: string | null;
};
type SalesBody = {
  scope: { merchantId: string; branchId: string | null };
  period: {
    period: string;
    timezone: string;
    from: string;
    to: string;
    interval: string;
    localFrom: string;
    localToInclusive: string;
  };
  asOf: string;
  currency: string;
  dataStatus: 'COMPLETE' | 'MISSING_FINANCIAL_SNAPSHOT';
  completedOrderCount: number;
  grossMerchandiseMinor: string | null;
  averageBasketMinor: string | null;
  cancelledOrderCount: number;
  financeAccess: 'GRANTED' | 'ROLE_RESTRICTED';
  finance: {
    merchantDiscountMinor: string | null;
    commissionMinor: string | null;
    merchantNetMinor: string | null;
    uniformCommissionRateBps: number | null;
    refundsCompletedCount: number;
    recordedRefundAdjustmentsMinor: string;
  } | null;
  trend: { granularity: 'HOUR' | 'DAY'; buckets: TrendBucket[] };
};
type TopBody = {
  scope: { merchantId: string; branchId: string | null };
  sort: string;
  distinctProductCount: number;
  items: Array<{
    rank: number;
    productId: string | null;
    name: string;
    orderCount: number;
    quantity: number;
    revenueMinor: string;
  }>;
};

/** Saturday 2031-03-15 11:30 Africa/Algiers (UTC+1). */
const CLOCK_NOW = new Date('2031-03-15T10:30:00.000Z');
const FIXTURE_DEVICE_NAME = 'merchant-sales-reports-e2e';
const FIXTURE_ZONE_PREFIX = 'Merchant reports zone ';
const FIXTURE_ROLE_PREFIX = 'merchant-reports-';

describe('Merchant sales reports (e2e)', () => {
  jest.setTimeout(180_000);

  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OTP_SENDER)
      .useClass(TestOtpSender)
      .overrideProvider(MERCHANT_REPORTS_CLOCK)
      .useValue(() => new Date(CLOCK_NOW.getTime()))
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sender = moduleRef.get(OTP_SENDER);
    prisma = moduleRef.get(PrismaService);
    await cleanupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
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
        deviceName: FIXTURE_DEVICE_NAME,
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

  async function cleanupOrder(orderId: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    for (const refund of await db.Refund.where({ orderId }).all()) {
      await db.Refund.where({ id: refund.id }).delete();
    }
    for (const item of await db.OrderItem.where({ orderId }).all()) {
      await db.OrderItem.where({ id: item.id }).delete();
    }
    await db.OrderCancellation.where({ orderId }).delete();
    await db.OrderFinancialSnapshot.where({ orderId }).delete();
    await db.Order.where({ id: orderId }).delete();
  }

  async function cleanupMerchant(merchantId: string): Promise<void> {
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
    const branches = await db.MerchantBranch.where({ merchantId }).all();
    for (const branch of branches) {
      for (const order of await db.Order.where({
        merchantBranchId: branch.id,
      }).all()) {
        await cleanupOrder(order.id);
      }
    }
    for (const rule of await db.MerchantCommissionRule.where({
      merchantId,
    }).all()) {
      for (const snap of await db.OrderFinancialSnapshot.where({
        commissionRuleId: rule.id,
      }).all()) {
        await cleanupOrder(snap.orderId);
      }
      await db.MerchantCommissionRule.where({ id: rule.id }).delete();
    }
    for (const branch of branches) {
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
      await deleteBranchOpeningHours(prisma, branch.id);
      await db.MerchantBranch.where({ id: branch.id }).delete();
    }
    for (const member of await db.MerchantMember.where({
      merchantId,
    }).all()) {
      await db.MerchantMember.where({ id: member.id }).delete();
    }
    await db.Merchant.where({ id: merchantId }).delete();
  }

  /**
   * Removes every fixture created by this suite (current or interrupted runs),
   * keyed on the suite's device name and fixture name prefixes — never on
   * phone prefixes shared with other suites.
   */
  async function cleanupFixtures(): Promise<void> {
    const db = prisma.getDb().orm.public;
    const accountIds = [
      ...new Set(
        (
          await db.Device.where({
            deviceName: pgVarchar<128>(FIXTURE_DEVICE_NAME),
          }).all()
        ).map((d) => d.accountId),
      ),
    ];
    for (const accountId of accountIds) {
      const customer = await db.CustomerProfile.where({ accountId }).first();
      if (customer) {
        for (const order of await db.Order.where({
          customerId: customer.id,
        }).all()) {
          await cleanupOrder(order.id);
        }
      }
      for (const membership of await db.MerchantMember.where({
        accountId,
      }).all()) {
        await cleanupMerchant(membership.merchantId);
      }
    }
    for (const accountId of accountIds) {
      await db.AdminProfile.where({ accountId }).delete();
      await db.CustomerProfile.where({ accountId }).delete();
      for (const session of await db.Session.where({ accountId }).all()) {
        await db.Session.where({ id: session.id }).delete();
      }
      for (const device of await db.Device.where({ accountId }).all()) {
        await db.Device.where({ id: device.id }).delete();
      }
      await deleteAccountNotificationArtifacts(prisma, accountId);
      await db.Account.where({ id: accountId }).delete();
    }
    for (const zone of await db.DeliveryZone.all()) {
      if (!zone.name.startsWith(FIXTURE_ZONE_PREFIX)) {
        continue;
      }
      for (const order of await db.Order.where({
        deliveryZoneId: zone.id,
      }).all()) {
        await cleanupOrder(order.id);
      }
      for (const rule of await db.DeliveryPricingRule.where({
        zoneId: zone.id,
      }).all()) {
        await db.DeliveryPricingRule.where({ id: rule.id }).delete();
      }
      await db.DeliveryZone.where({ id: zone.id }).delete();
    }
    for (const role of await db.Role.all()) {
      if (role.name.startsWith(FIXTURE_ROLE_PREFIX)) {
        await db.Role.where({ id: role.id }).delete();
      }
    }
  }

  it('aggregates completed sales per Africa/Algiers period with branch isolation, snapshot finance, and top products', async () => {
    const suffix = Date.now().toString().slice(-6);
    const server = app.getHttpServer();
    const db = prisma.getDb().orm.public;

    const ownerAToken = await authenticate(`0591${suffix}`);
    const staffAToken = await authenticate(`0592${suffix}`);
    const ownerBToken = await authenticate(`0593${suffix}`);
    const outsiderToken = await authenticate(`0594${suffix}`);
    const customerToken = await authenticate(`0595${suffix}`);
    const adminToken = await authenticate(`0596${suffix}`);
    const ownerA = await authMe(ownerAToken);
    const staffA = await authMe(staffAToken);
    const ownerB = await authMe(ownerBToken);
    await authMe(outsiderToken);
    const customerAcct = await authMe(customerToken);
    const adminAcct = await authMe(adminToken);

    const now = pgNow();
    const roleId = createUuidV7();
    await db.Role.create({
      id: roleId,
      name: pgVarchar<128>(`${FIXTURE_ROLE_PREFIX}${suffix}`),
      description: null,
      active: true,
    });
    const adminId = createUuidV7();
    await db.AdminProfile.create({
      id: adminId,
      accountId: adminAcct.id,
      roleId,
      displayName: pgVarchar<255>('Merchant Reports Admin'),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });

    await request(server)
      .post('/api/v1/customer/profile')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'Reports Customer' });
    const customerProfile = await db.CustomerProfile.where({
      accountId: customerAcct.id,
    }).first();
    expect(customerProfile).toBeTruthy();

    async function createMerchant(
      token: string,
      accountId: string,
      name: string,
      branchNames: string[],
      phonePrefix: string,
    ): Promise<{ merchantId: string; branchIds: string[] }> {
      const merchantRes = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name });
      expect(merchantRes.status).toBe(201);
      const merchantId = (merchantRes.body as { merchantId: string })
        .merchantId;
      const branchIds: string[] = [];
      for (const [index, branchName] of branchNames.entries()) {
        const branchRes = await request(server)
          .post(`/api/v1/merchant/${merchantId}/branches`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: branchName,
            phone: `${phonePrefix}${index}${suffix.slice(1)}`,
            addressText: 'Pickup',
            latitude: 36.75,
            longitude: 3.05,
            wilayaCode: '16',
            communeId: 556,
          });
        expect(branchRes.status).toBe(201);
        const branchId = (branchRes.body as { id: string }).id;
        await ensureBranchOpeningHours(prisma, branchId, accountId);
        branchIds.push(branchId);
      }
      return { merchantId, branchIds };
    }

    const {
      merchantId,
      branchIds: [branchA1, branchA2],
    } = await createMerchant(
      ownerAToken,
      ownerA.id,
      `Sales Shop A ${suffix}`,
      ['A1', 'A2'],
      '0557',
    );
    const {
      merchantId: merchantBId,
      branchIds: [branchB1],
    } = await createMerchant(
      ownerBToken,
      ownerB.id,
      `Sales Shop B ${suffix}`,
      ['B1'],
      '0556',
    );

    const staffMemberId = createUuidV7();
    await db.MerchantMember.create({
      id: staffMemberId,
      merchantId,
      accountId: staffA.id,
      role: pgVarchar<64>('STAFF'),
      createdAt: now,
    });
    const zoneId = createUuidV7();
    await db.DeliveryZone.create({
      id: zoneId,
      name: pgVarchar<255>(`${FIXTURE_ZONE_PREFIX}${suffix}`),
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [3.0, 36.7],
              [3.1, 36.7],
              [3.1, 36.8],
              [3.0, 36.8],
              [3.0, 36.7],
            ],
          ],
        ],
        srid: 4326,
      },
      active: false,
      createdAt: now,
      updatedAt: now,
    });
    const pricingRuleId = createUuidV7();
    await db.DeliveryPricingRule.create({
      id: pricingRuleId,
      zoneId,
      name: pgVarchar<255>(`Merchant reports pricing ${suffix}`),
      timeBand: 'DAY',
      startLocalTime: null,
      endLocalTime: null,
      customerDeliveryFeeMinor: pgBigInt(200),
      driverRemunerationMinor: pgBigInt(150),
      effectiveFrom: pgTimestamptz('2020-01-01T00:00:00.000Z'),
      effectiveTo: null,
      active: false,
      createdAt: now,
      updatedAt: now,
    });
    const commissionRuleId = createUuidV7();
    await db.MerchantCommissionRule.create({
      id: commissionRuleId,
      scope: 'MERCHANT_OVERRIDE',
      merchantId,
      rateBps: 700,
      effectiveFrom: pgTimestamptz('2020-01-01T00:00:00.000Z'),
      effectiveTo: null,
      changeReason: null,
      changedByAdminId: adminId,
      active: false,
      createdAt: now,
    });
    async function seedProduct(branchId: string, name: string) {
      const categoryId = createUuidV7();
      await db.Category.create({
        id: categoryId,
        merchantBranchId: branchId,
        name: pgVarchar<255>(`Cat ${name}`),
        sortOrder: 0,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      const productId = createUuidV7();
      await db.Product.create({
        id: productId,
        merchantBranchId: branchId,
        categoryId,
        name: pgVarchar<255>(name),
        description: null,
        priceMinor: pgBigInt(1000),
        available: true,
        createdAt: now,
        updatedAt: now,
      });
      return productId;
    }
    const couscousId = await seedProduct(branchA1, 'Couscous royal');
    const teaId = await seedProduct(branchA1, 'Thé à la menthe');

    type Item = {
      productId: string | null;
      name: string;
      qty: number;
      unit: number;
    };
    async function seedOrder(opts: {
      branchId: string;
      status: 'COMPLETED' | 'CANCELLED' | 'ACTIVE' | 'FAILED';
      createdAt: string;
      completedAt?: string;
      cancelledAt?: string;
      snapshot?: {
        merchantDiscount?: number;
        rateBps: number;
        commission: number;
        net: number;
      };
      items: Item[];
    }): Promise<string> {
      const orderId = createUuidV7();
      const gms = opts.items.reduce((sum, i) => sum + i.qty * i.unit, 0);
      await db.Order.create({
        id: orderId,
        publicReference: pgVarchar<64>(
          `sgo_msr_${orderId.replace(/-/g, '').slice(0, 20)}`,
        ),
        customerId: customerProfile!.id,
        merchantBranchId: opts.branchId,
        deliveryZoneId: zoneId,
        status: opts.status as never,
        fulfillmentStatus: 'READY',
        createdAt: pgTimestamptz(opts.createdAt),
        confirmedAt: pgTimestamptz(opts.createdAt),
        completedAt: opts.completedAt ? pgTimestamptz(opts.completedAt) : null,
        updatedAt: pgTimestamptz(opts.completedAt ?? opts.createdAt),
      } as never);
      for (const item of opts.items) {
        await db.OrderItem.create({
          id: createUuidV7(),
          orderId,
          productId: item.productId,
          productNameSnapshot: pgVarchar<255>(item.name),
          quantity: item.qty,
          unitPriceMinor: pgBigInt(item.unit),
          lineTotalMinor: pgBigInt(item.qty * item.unit),
        });
      }
      if (opts.snapshot) {
        const discount = opts.snapshot.merchantDiscount ?? 0;
        await db.OrderFinancialSnapshot.create({
          orderId,
          currency: pgChar<3>('DZD'),
          grossMerchandiseSubtotalMinor: pgBigInt(gms),
          merchantDiscountMinor: pgBigInt(discount),
          platformDiscountMinor: pgBigInt(0),
          totalDiscountMinor: pgBigInt(discount),
          commissionBaseMinor: pgBigInt(gms - discount),
          merchantCommissionRateBps: opts.snapshot.rateBps,
          merchantCommissionAmountMinor: pgBigInt(opts.snapshot.commission),
          merchantNetAmountMinor: pgBigInt(opts.snapshot.net),
          customerDeliveryFeeMinor: pgBigInt(200),
          driverRemunerationMinor: pgBigInt(150),
          speedyGoDeliveryShareMinor: pgBigInt(50),
          serviceFeeMinor: pgBigInt(0),
          customerPayableMinor: pgBigInt(gms - discount + 200),
          commissionRuleId,
          pricingRuleId,
          createdAt: pgTimestamptz(opts.createdAt),
        });
      }
      if (opts.cancelledAt) {
        await db.OrderCancellation.create({
          id: createUuidV7(),
          orderId,
          reason: pgVarchar<255>('merchant-sales-reports-e2e'),
          internalNote: null,
          cancelledByAccountId: null,
          cancelledAt: pgTimestamptz(opts.cancelledAt),
        });
      }
      return orderId;
    }

    async function seedRefund(
      orderId: string,
      status: 'REFUNDED' | 'APPROVED',
      completedAt: string | null,
      amount: number,
    ): Promise<string> {
      const refundId = createUuidV7();
      await db.Refund.create({
        id: refundId,
        orderId,
        paymentTransactionId: null,
        refundMethod: 'MANUAL_OTHER',
        amountMinor: pgBigInt(amount),
        status: status as never,
        reason: pgVarchar<255>('merchant-sales-reports-e2e'),
        internalNote: null,
        requestedByAdminId: adminId,
        requestedAt: pgTimestamptz('2031-03-01T08:00:00.000Z'),
        completedAt: completedAt ? pgTimestamptz(completedAt) : null,
        createdAt: pgTimestamptz('2031-03-01T08:00:00.000Z'),
      } as never);
      return refundId;
    }

    // o1: first instant of local 2031-03-15 (00:00 Algiers) — TODAY, excluded from YESTERDAY.
    const o1 = await seedOrder({
      branchId: branchA1,
      status: 'COMPLETED',
      createdAt: '2031-03-14T22:30:00.000Z',
      completedAt: '2031-03-14T23:00:00.000Z',
      snapshot: { rateBps: 700, commission: 700, net: 9300 },
      items: [
        { productId: couscousId, name: 'Couscous royal', qty: 2, unit: 4000 },
        { productId: teaId, name: 'Thé à la menthe', qty: 2, unit: 1000 },
      ],
    });
    // o2: local 10:15 with a merchant-funded discount.
    const o2 = await seedOrder({
      branchId: branchA1,
      status: 'COMPLETED',
      createdAt: '2031-03-15T08:50:00.000Z',
      completedAt: '2031-03-15T09:15:00.000Z',
      snapshot: {
        merchantDiscount: 1000,
        rateBps: 700,
        commission: 280,
        net: 3720,
      },
      items: [
        { productId: couscousId, name: 'Couscous royal', qty: 1, unit: 5000 },
      ],
    });
    // o3: last millisecond of local 2031-03-14 at a historical 10% rate; older product name.
    const o3 = await seedOrder({
      branchId: branchA1,
      status: 'COMPLETED',
      createdAt: '2031-03-14T22:00:00.000Z',
      completedAt: '2031-03-14T22:59:59.999Z',
      snapshot: { rateBps: 1000, commission: 300, net: 2700 },
      items: [
        {
          productId: teaId,
          name: 'Thé (ancien libellé)',
          qty: 3,
          unit: 1000,
        },
      ],
    });
    // Cancelled today (with items and snapshot) — counted as cancellation, never as sales.
    await seedOrder({
      branchId: branchA1,
      status: 'CANCELLED',
      createdAt: '2031-03-15T08:00:00.000Z',
      cancelledAt: '2031-03-15T08:05:00.000Z',
      snapshot: { rateBps: 700, commission: 490, net: 6510 },
      items: [
        { productId: couscousId, name: 'Couscous royal', qty: 5, unit: 1400 },
      ],
    });
    // Cancelled at local 23:00 on 2031-03-14 — YESTERDAY cancellation.
    await seedOrder({
      branchId: branchA1,
      status: 'CANCELLED',
      createdAt: '2031-03-14T21:30:00.000Z',
      cancelledAt: '2031-03-14T22:00:00.000Z',
      items: [
        { productId: teaId, name: 'Thé à la menthe', qty: 1, unit: 1000 },
      ],
    });
    // Active (in progress) and FAILED today — neither sales nor cancellations.
    await seedOrder({
      branchId: branchA1,
      status: 'ACTIVE',
      createdAt: '2031-03-15T08:30:00.000Z',
      snapshot: { rateBps: 700, commission: 280, net: 3720 },
      items: [
        { productId: teaId, name: 'Thé à la menthe', qty: 4, unit: 1000 },
      ],
    });
    await seedOrder({
      branchId: branchA1,
      status: 'FAILED',
      createdAt: '2031-03-15T07:30:00.000Z',
      snapshot: { rateBps: 700, commission: 70, net: 930 },
      items: [
        { productId: teaId, name: 'Thé à la menthe', qty: 1, unit: 1000 },
      ],
    });
    // o7: branch A2, local 11:00, deleted product (productId null).
    await seedOrder({
      branchId: branchA2,
      status: 'COMPLETED',
      createdAt: '2031-03-15T09:40:00.000Z',
      completedAt: '2031-03-15T10:00:00.000Z',
      snapshot: { rateBps: 700, commission: 140, net: 1860 },
      items: [{ productId: null, name: 'Pain maison', qty: 4, unit: 500 }],
    });
    // o8: other Merchant — must never leak into Merchant A.
    const o8 = await seedOrder({
      branchId: branchB1,
      status: 'COMPLETED',
      createdAt: '2031-03-15T09:40:00.000Z',
      completedAt: '2031-03-15T10:00:00.000Z',
      snapshot: { rateBps: 700, commission: 6993, net: 92907 },
      items: [{ productId: null, name: 'Pizza géante', qty: 1, unit: 99900 }],
    });
    // o9: local Sunday 2031-03-09 23:59:59 — THIS_MONTH only (before THIS_WEEK Monday).
    const o9 = await seedOrder({
      branchId: branchA1,
      status: 'COMPLETED',
      createdAt: '2031-03-09T22:00:00.000Z',
      completedAt: '2031-03-09T22:59:59.000Z',
      snapshot: { rateBps: 700, commission: 70, net: 930 },
      items: [
        { productId: teaId, name: 'Thé à la menthe', qty: 1, unit: 1000 },
      ],
    });

    const r1 = await seedRefund(
      o1,
      'REFUNDED',
      '2031-03-15T10:00:00.000Z',
      3000,
    );
    await seedRefund(o2, 'APPROVED', null, 999);
    await seedRefund(o3, 'REFUNDED', '2031-03-15T09:00:00.000Z', 500);
    const r4 = await seedRefund(
      o9,
      'REFUNDED',
      '2031-03-12T10:00:00.000Z',
      450,
    );
    await seedRefund(o8, 'REFUNDED', '2031-03-15T09:00:00.000Z', 5000);

    const settlementId = createUuidV7();
    await db.MerchantSettlement.create({
      id: settlementId,
      merchantId,
      periodStart: pgTimestamptz('2031-02-28T23:00:00.000Z'),
      periodEnd: pgTimestamptz('2031-03-31T22:00:00.000Z'),
      grossSalesMinor: pgBigInt(0),
      commissionMinor: pgBigInt(0),
      refundAdjustmentsMinor: pgBigInt(-2900),
      manualAdjustmentsMinor: pgBigInt(0),
      netPayableMinor: pgBigInt(-2900),
      status: pgVarchar<64>('DRAFT'),
      paidAt: null,
      createdAt: now,
    });
    for (const [refundId, orderId, adjustment] of [
      [r1, o1, -2500],
      [r4, o9, -400],
    ] as const) {
      await db.MerchantSettlementLine.create({
        id: createUuidV7(),
        settlementId,
        orderId,
        type: 'REFUND_ADJUSTMENT',
        grossMerchandiseMinor: pgBigInt(0),
        commissionMinor: pgBigInt(0),
        merchantNetMinor: pgBigInt(0),
        adjustmentMinor: pgBigInt(adjustment),
        reference: pgVarchar<128>(refundId),
        createdAt: now,
      } as never);
    }

    const base = `/api/v1/merchant/${merchantId}/reports`;
    async function sales(
      token: string,
      query: string,
      expectedStatus = 200,
    ): Promise<SalesBody> {
      const res = await request(server)
        .get(`${base}/sales?${query}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(expectedStatus);
      return res.body as SalesBody;
    }
    async function top(token: string, query: string): Promise<TopBody> {
      const res = await request(server)
        .get(`${base}/top-products?${query}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      return res.body as TopBody;
    }
    const bucketSum = (body: SalesBody) =>
      body.trend.buckets.reduce(
        (sum, b) => sum + BigInt(b.grossMerchandiseMinor ?? '0'),
        0n,
      );

    // --- Access -------------------------------------------------------------
    const anonymous = await request(server).get(`${base}/sales?period=TODAY`);
    expect(anonymous.status).toBe(401);

    const outsider = await request(server)
      .get(`${base}/sales?period=TODAY`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(outsider.status).toBe(404);
    expect((outsider.body as ErrorBody).error.code).toBe('MERCHANT_NOT_FOUND');

    const crossMerchant = await request(server)
      .get(`${base}/top-products?period=TODAY`)
      .set('Authorization', `Bearer ${ownerBToken}`);
    expect(crossMerchant.status).toBe(404);
    expect((crossMerchant.body as ErrorBody).error.code).toBe(
      'MERCHANT_NOT_FOUND',
    );

    const foreignBranch = await request(server)
      .get(`${base}/sales?period=TODAY&branchId=${branchB1}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(foreignBranch.status).toBe(404);
    expect((foreignBranch.body as ErrorBody).error.code).toBe(
      'MERCHANT_BRANCH_NOT_FOUND',
    );
    const foreignBranchTop = await request(server)
      .get(`${base}/top-products?period=TODAY&branchId=${branchB1}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(foreignBranchTop.status).toBe(404);

    // --- Validation ---------------------------------------------------------
    for (const query of [
      'period=BOGUS',
      'period=TODAY&branchId=not-a-uuid',
      'period=CUSTOM&from=2031-3-1&to=2031-03-02',
    ]) {
      const res = await request(server)
        .get(`${base}/sales?${query}`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(res.status).toBe(400);
    }
    for (const query of [
      'period=CUSTOM',
      'period=CUSTOM&from=2031-03-10',
      'period=CUSTOM&from=2031-03-12&to=2031-03-10',
      'period=CUSTOM&from=2031-03-15&to=2031-03-16',
      'period=CUSTOM&from=2030-11-01&to=2031-03-15',
      'period=CUSTOM&from=2031-02-30&to=2031-03-01',
      'period=TODAY&from=2031-03-10&to=2031-03-11',
    ]) {
      const res = await request(server)
        .get(`${base}/sales?${query}`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe('REPORTS_INVALID_INPUT');
    }
    for (const query of [
      'period=TODAY&limit=0',
      'period=TODAY&limit=51',
      'period=TODAY&sort=QTY',
    ]) {
      const res = await request(server)
        .get(`${base}/top-products?${query}`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(res.status).toBe(400);
    }

    // --- TODAY, all branches -----------------------------------------------
    const today = await sales(ownerAToken, 'period=TODAY');
    expect(today).toMatchObject({
      scope: { merchantId, branchId: null },
      period: {
        period: 'TODAY',
        timezone: 'Africa/Algiers',
        from: '2031-03-14T23:00:00.000Z',
        to: '2031-03-15T23:00:00.000Z',
        interval: '[from, to)',
        localFrom: '2031-03-15',
        localToInclusive: '2031-03-15',
      },
      asOf: CLOCK_NOW.toISOString(),
      currency: 'DZD',
      dataStatus: 'COMPLETE',
      completedOrderCount: 3,
      grossMerchandiseMinor: '17000',
      averageBasketMinor: '5666',
      cancelledOrderCount: 1,
      financeAccess: 'GRANTED',
      finance: {
        merchantDiscountMinor: '1000',
        commissionMinor: '1120',
        merchantNetMinor: '14880',
        uniformCommissionRateBps: 700,
        refundsCompletedCount: 2,
        recordedRefundAdjustmentsMinor: '-2500',
      },
      trend: { granularity: 'HOUR' },
    });
    expect(today.trend.buckets).toHaveLength(12);
    expect(today.trend.buckets.map((b) => b.localStart)).toEqual(
      Array.from(
        { length: 12 },
        (_, h) => `2031-03-15T${String(h).padStart(2, '0')}:00`,
      ),
    );
    expect(today.trend.buckets[0]).toEqual({
      start: '2031-03-14T23:00:00.000Z',
      localStart: '2031-03-15T00:00',
      completedOrderCount: 1,
      grossMerchandiseMinor: '10000',
    });
    expect(today.trend.buckets[10]).toMatchObject({
      completedOrderCount: 1,
      grossMerchandiseMinor: '5000',
    });
    expect(today.trend.buckets[11]).toMatchObject({
      completedOrderCount: 1,
      grossMerchandiseMinor: '2000',
    });
    expect(today.trend.buckets[5]).toMatchObject({
      completedOrderCount: 0,
      grossMerchandiseMinor: '0',
    });
    const starts = today.trend.buckets.map((b) => Date.parse(b.start));
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(bucketSum(today)).toBe(17000n);

    // --- Branch isolation ---------------------------------------------------
    const todayA1 = await sales(
      ownerAToken,
      `period=TODAY&branchId=${branchA1}`,
    );
    expect(todayA1).toMatchObject({
      scope: { merchantId, branchId: branchA1 },
      completedOrderCount: 2,
      grossMerchandiseMinor: '15000',
      averageBasketMinor: '7500',
      cancelledOrderCount: 1,
      finance: {
        merchantDiscountMinor: '1000',
        commissionMinor: '980',
        merchantNetMinor: '13020',
        refundsCompletedCount: 2,
        recordedRefundAdjustmentsMinor: '-2500',
      },
    });
    expect(bucketSum(todayA1)).toBe(15000n);
    const todayA2 = await sales(
      ownerAToken,
      `period=TODAY&branchId=${branchA2}`,
    );
    expect(todayA2).toMatchObject({
      scope: { merchantId, branchId: branchA2 },
      completedOrderCount: 1,
      grossMerchandiseMinor: '2000',
      cancelledOrderCount: 0,
      finance: {
        commissionMinor: '140',
        merchantNetMinor: '1860',
        refundsCompletedCount: 0,
        recordedRefundAdjustmentsMinor: '0',
      },
    });

    // Merchant B sees only its own sales.
    const todayB = await request(server)
      .get(`/api/v1/merchant/${merchantBId}/reports/sales?period=TODAY`)
      .set('Authorization', `Bearer ${ownerBToken}`);
    expect(todayB.status).toBe(200);
    expect(todayB.body).toMatchObject({
      completedOrderCount: 1,
      grossMerchandiseMinor: '99900',
      finance: {
        refundsCompletedCount: 1,
        recordedRefundAdjustmentsMinor: '0',
      },
    });

    // --- STAFF: operational metrics only ------------------------------------
    const staffToday = await sales(staffAToken, 'period=TODAY');
    expect(staffToday).toMatchObject({
      completedOrderCount: 3,
      grossMerchandiseMinor: '17000',
      financeAccess: 'ROLE_RESTRICTED',
      finance: null,
    });
    const staffTop = await top(staffAToken, 'period=TODAY');
    expect(staffTop.items).toHaveLength(3);

    // --- YESTERDAY: exclusive upper bound + historical snapshot rate ---------
    const yesterday = await sales(ownerAToken, 'period=YESTERDAY');
    expect(yesterday).toMatchObject({
      period: {
        from: '2031-03-13T23:00:00.000Z',
        to: '2031-03-14T23:00:00.000Z',
        localFrom: '2031-03-14',
      },
      completedOrderCount: 1,
      grossMerchandiseMinor: '3000',
      cancelledOrderCount: 1,
      finance: {
        commissionMinor: '300',
        merchantNetMinor: '2700',
        uniformCommissionRateBps: 1000,
        refundsCompletedCount: 0,
        recordedRefundAdjustmentsMinor: '0',
      },
    });
    expect(yesterday.trend.buckets).toHaveLength(24);
    expect(yesterday.trend.buckets[23]).toMatchObject({
      localStart: '2031-03-14T23:00',
      completedOrderCount: 1,
      grossMerchandiseMinor: '3000',
    });

    // Changing today's commission rule must not rewrite historical figures.
    await db.MerchantCommissionRule.where({ id: commissionRuleId }).update({
      rateBps: 5000,
    });
    const yesterdayAfterRuleChange = await sales(
      ownerAToken,
      'period=YESTERDAY',
    );
    expect(yesterdayAfterRuleChange.finance).toMatchObject({
      commissionMinor: '300',
      uniformCommissionRateBps: 1000,
    });

    // --- THIS_WEEK (Monday 2031-03-10 → today) -----------------------------
    const week = await sales(ownerAToken, 'period=THIS_WEEK');
    expect(week).toMatchObject({
      period: {
        from: '2031-03-09T23:00:00.000Z',
        to: '2031-03-16T23:00:00.000Z',
        localFrom: '2031-03-10',
        localToInclusive: '2031-03-16',
      },
      completedOrderCount: 4,
      grossMerchandiseMinor: '20000',
      averageBasketMinor: '5000',
      cancelledOrderCount: 2,
      finance: {
        commissionMinor: '1420',
        merchantNetMinor: '17580',
        uniformCommissionRateBps: null,
        refundsCompletedCount: 3,
        recordedRefundAdjustmentsMinor: '-2900',
      },
      trend: { granularity: 'DAY' },
    });
    expect(week.trend.buckets.map((b) => b.localStart)).toEqual([
      '2031-03-10',
      '2031-03-11',
      '2031-03-12',
      '2031-03-13',
      '2031-03-14',
      '2031-03-15',
    ]);
    expect(week.trend.buckets[4]).toMatchObject({
      completedOrderCount: 1,
      grossMerchandiseMinor: '3000',
    });
    expect(week.trend.buckets[5]).toMatchObject({
      completedOrderCount: 3,
      grossMerchandiseMinor: '17000',
    });
    expect(bucketSum(week)).toBe(20000n);

    // --- THIS_MONTH ---------------------------------------------------------
    const month = await sales(ownerAToken, 'period=THIS_MONTH');
    expect(month).toMatchObject({
      period: {
        from: '2031-02-28T23:00:00.000Z',
        to: '2031-03-31T23:00:00.000Z',
      },
      completedOrderCount: 5,
      grossMerchandiseMinor: '21000',
    });
    expect(month.trend.buckets).toHaveLength(15);
    expect(month.trend.buckets[8]).toMatchObject({
      localStart: '2031-03-09',
      completedOrderCount: 1,
      grossMerchandiseMinor: '1000',
    });
    expect(bucketSum(month)).toBe(21000n);

    // --- CUSTOM -------------------------------------------------------------
    const custom = await sales(
      ownerAToken,
      'period=CUSTOM&from=2031-03-09&to=2031-03-09',
    );
    expect(custom).toMatchObject({
      period: {
        period: 'CUSTOM',
        from: '2031-03-08T23:00:00.000Z',
        to: '2031-03-09T23:00:00.000Z',
      },
      completedOrderCount: 1,
      grossMerchandiseMinor: '1000',
      trend: { granularity: 'HOUR' },
    });
    expect(custom.trend.buckets).toHaveLength(24);
    expect(custom.trend.buckets[23].completedOrderCount).toBe(1);

    // --- Zero activity returns zeros (not nulls) ----------------------------
    const empty = await sales(
      ownerAToken,
      'period=CUSTOM&from=2031-03-11&to=2031-03-11',
    );
    expect(empty).toMatchObject({
      dataStatus: 'COMPLETE',
      completedOrderCount: 0,
      grossMerchandiseMinor: '0',
      averageBasketMinor: null,
      cancelledOrderCount: 0,
      finance: {
        merchantDiscountMinor: '0',
        commissionMinor: '0',
        merchantNetMinor: '0',
        uniformCommissionRateBps: null,
        refundsCompletedCount: 0,
        recordedRefundAdjustmentsMinor: '0',
      },
    });
    expect(empty.trend.buckets).toHaveLength(24);
    expect(
      empty.trend.buckets.every(
        (b) => b.completedOrderCount === 0 && b.grossMerchandiseMinor === '0',
      ),
    ).toBe(true);
    const emptyTop = await top(
      ownerAToken,
      'period=CUSTOM&from=2031-03-11&to=2031-03-11',
    );
    expect(emptyTop).toMatchObject({ distinctProductCount: 0, items: [] });

    // --- Top products -------------------------------------------------------
    const topToday = await top(ownerAToken, 'period=TODAY');
    expect(topToday).toMatchObject({
      sort: 'ORDERS',
      distinctProductCount: 3,
      items: [
        {
          rank: 1,
          productId: couscousId,
          name: 'Couscous royal',
          orderCount: 2,
          quantity: 3,
          revenueMinor: '13000',
        },
        {
          rank: 2,
          productId: null,
          name: 'Pain maison',
          orderCount: 1,
          quantity: 4,
          revenueMinor: '2000',
        },
        {
          rank: 3,
          productId: teaId,
          name: 'Thé à la menthe',
          orderCount: 1,
          quantity: 2,
          revenueMinor: '2000',
        },
      ],
    });
    expect(
      topToday.items.reduce((sum, i) => sum + BigInt(i.revenueMinor), 0n),
    ).toBe(BigInt(today.grossMerchandiseMinor!));

    const weekByOrders = await top(ownerAToken, 'period=THIS_WEEK&sort=ORDERS');
    expect(
      weekByOrders.items.map((i) => [
        i.name,
        i.orderCount,
        i.quantity,
        i.revenueMinor,
      ]),
    ).toEqual([
      ['Thé à la menthe', 2, 5, '5000'],
      ['Couscous royal', 2, 3, '13000'],
      ['Pain maison', 1, 4, '2000'],
    ]);
    const weekByRevenue = await top(
      ownerAToken,
      'period=THIS_WEEK&sort=REVENUE',
    );
    expect(weekByRevenue.sort).toBe('REVENUE');
    expect(weekByRevenue.items.map((i) => i.name)).toEqual([
      'Couscous royal',
      'Thé à la menthe',
      'Pain maison',
    ]);
    const limited = await top(ownerAToken, 'period=THIS_WEEK&limit=1');
    expect(limited.distinctProductCount).toBe(3);
    expect(limited.items).toHaveLength(1);

    const topA1 = await top(ownerAToken, `period=TODAY&branchId=${branchA1}`);
    expect(topA1.items.map((i) => i.name)).toEqual([
      'Couscous royal',
      'Thé à la menthe',
    ]);
    const topA2 = await top(ownerAToken, `period=TODAY&branchId=${branchA2}`);
    expect(topA2.items).toEqual([
      {
        rank: 1,
        productId: null,
        name: 'Pain maison',
        orderCount: 1,
        quantity: 4,
        revenueMinor: '2000',
      },
    ]);

    // --- STAFF on both routes: merchandise figures only, never finance -----
    const financeTerms =
      /commission|merchantNet|merchantDiscount|refund|adjustment|settlement|payout|rateBps/i;
    const staffWeek = await sales(staffAToken, 'period=THIS_WEEK');
    expect(staffWeek).toMatchObject({
      completedOrderCount: 4,
      grossMerchandiseMinor: '20000',
      averageBasketMinor: '5000',
      cancelledOrderCount: 2,
      financeAccess: 'ROLE_RESTRICTED',
      finance: null,
    });
    expect(staffWeek.trend).toEqual(week.trend);
    expect(JSON.stringify(staffWeek)).not.toMatch(financeTerms);

    const staffWeekByRevenue = await top(
      staffAToken,
      'period=THIS_WEEK&sort=REVENUE',
    );
    expect(staffWeekByRevenue.sort).toBe('REVENUE');
    expect(staffWeekByRevenue.items).toEqual(weekByRevenue.items);
    expect(
      staffWeekByRevenue.items.map((i) => [i.rank, i.name, i.revenueMinor]),
    ).toEqual([
      [1, 'Couscous royal', '13000'],
      [2, 'Thé à la menthe', '5000'],
      [3, 'Pain maison', '2000'],
    ]);
    // Product revenue is merchandise (Σ line totals), not commission or net.
    expect(
      staffWeekByRevenue.items.reduce(
        (sum, i) => sum + BigInt(i.revenueMinor),
        0n,
      ),
    ).toBe(BigInt(staffWeek.grossMerchandiseMinor!));
    const staffTopToday = await top(staffAToken, 'period=TODAY&sort=ORDERS');
    expect(staffTopToday.items).toEqual(topToday.items);
    const staffA1ByRevenue = await top(
      staffAToken,
      `period=TODAY&branchId=${branchA1}&sort=REVENUE`,
    );
    const ownerA1ByRevenue = await top(
      ownerAToken,
      `period=TODAY&branchId=${branchA1}&sort=REVENUE`,
    );
    expect(staffA1ByRevenue.items).toEqual(ownerA1ByRevenue.items);
    expect(staffA1ByRevenue.items.map((i) => i.name)).toEqual([
      'Couscous royal',
      'Thé à la menthe',
    ]);

    const topItemKeys = [
      'name',
      'orderCount',
      'productId',
      'quantity',
      'rank',
      'revenueMinor',
    ];
    for (const body of [
      staffWeekByRevenue,
      staffTopToday,
      weekByRevenue,
      topToday,
    ]) {
      expect(Object.keys(body).sort()).toEqual([
        'asOf',
        'currency',
        'distinctProductCount',
        'items',
        'period',
        'scope',
        'sort',
      ]);
      for (const item of body.items) {
        expect(Object.keys(item).sort()).toEqual(topItemKeys);
      }
      expect(JSON.stringify(body)).not.toMatch(financeTerms);
    }

    const staffForeignBranch = await request(server)
      .get(
        `${base}/top-products?period=TODAY&sort=REVENUE&branchId=${branchB1}`,
      )
      .set('Authorization', `Bearer ${staffAToken}`);
    expect(staffForeignBranch.status).toBe(404);
    expect((staffForeignBranch.body as ErrorBody).error.code).toBe(
      'MERCHANT_BRANCH_NOT_FOUND',
    );
    const staffOtherMerchant = await request(server)
      .get(
        `/api/v1/merchant/${merchantBId}/reports/top-products?period=TODAY&sort=REVENUE`,
      )
      .set('Authorization', `Bearer ${staffAToken}`);
    expect(staffOtherMerchant.status).toBe(404);
    expect((staffOtherMerchant.body as ErrorBody).error.code).toBe(
      'MERCHANT_NOT_FOUND',
    );

    // --- Missing financial snapshot: money becomes unavailable, not zero ----
    await seedOrder({
      branchId: branchA2,
      status: 'COMPLETED',
      createdAt: '2031-03-15T10:05:00.000Z',
      completedAt: '2031-03-15T10:20:00.000Z',
      items: [{ productId: null, name: 'Pain maison', qty: 1, unit: 500 }],
    });
    const missing = await sales(
      ownerAToken,
      `period=TODAY&branchId=${branchA2}`,
    );
    expect(missing).toMatchObject({
      dataStatus: 'MISSING_FINANCIAL_SNAPSHOT',
      completedOrderCount: 2,
      grossMerchandiseMinor: null,
      averageBasketMinor: null,
      finance: {
        merchantDiscountMinor: null,
        commissionMinor: null,
        merchantNetMinor: null,
        uniformCommissionRateBps: null,
        refundsCompletedCount: 0,
      },
    });
    expect(missing.trend.buckets[11]).toMatchObject({
      completedOrderCount: 2,
      grossMerchandiseMinor: null,
    });
    expect(
      missing.trend.buckets.every((b) => b.grossMerchandiseMinor === null),
    ).toBe(true);
    const stillCompleteA1 = await sales(
      ownerAToken,
      `period=TODAY&branchId=${branchA1}`,
    );
    expect(stillCompleteA1).toMatchObject({
      dataStatus: 'COMPLETE',
      grossMerchandiseMinor: '15000',
    });

    // Read-only: repeated read returns identical totals.
    const again = await sales(ownerAToken, `period=TODAY&branchId=${branchA1}`);
    expect(again.grossMerchandiseMinor).toBe('15000');
  });
});
