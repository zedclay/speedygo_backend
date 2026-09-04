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
import { PermissionService } from '../src/modules/authorization/permission.service';
import { ADMIN_PERMISSIONS } from '../src/modules/admin/domain/admin-permissions';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';
import { deactivateAllDeliveryZones } from './helpers/sanitize-delivery-zones';
import { deactivateOpenGlobalCommissionDefaults } from './helpers/sanitize-commission-globals';

type TokenBody = { accessToken: string };
type AuthMeBody = { account: { id: string; phone: string } };
type ErrorBody = { error: { code: string; message: string } };

const COVERING_RING: number[][] = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

describe('Reports Foundation (e2e)', () => {
  jest.setTimeout(180_000);

  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let permissions: PermissionService;
  const phones: string[] = [];
  const zoneIds: string[] = [];
  const pricingRuleIds: string[] = [];
  const commissionRuleIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OTP_SENDER)
      .useClass(TestOtpSender)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sender = moduleRef.get(OTP_SENDER);
    prisma = moduleRef.get(PrismaService);
    permissions = moduleRef.get(PermissionService);
  });

  afterAll(async () => {
    for (const phone of phones) {
      await cleanupByPhone(phone);
    }
    const db = prisma.getDb().orm.public;
    for (const id of commissionRuleIds) {
      for (const snap of await db.OrderFinancialSnapshot.where({
        commissionRuleId: id,
      }).all()) {
        await cleanupOrder(snap.orderId);
      }
      await db.MerchantCommissionRule.where({ id }).delete();
    }
    for (const id of pricingRuleIds) {
      for (const snap of await db.OrderFinancialSnapshot.where({
        pricingRuleId: id,
      }).all()) {
        await cleanupOrder(snap.orderId);
      }
      await db.DeliveryPricingRule.where({ id }).delete();
    }
    for (const zoneId of zoneIds) {
      for (const order of await db.Order.where({
        deliveryZoneId: zoneId,
      }).all()) {
        await cleanupOrder(order.id);
      }
      await db.DeliveryZone.where({ id: zoneId }).delete();
    }
    await app.close();
  });

  async function authenticate(phone: string): Promise<string> {
    phones.push(phone);
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
        deviceName: 'reports-foundation-e2e',
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

  async function seedAdminWithPermissions(
    accountId: string,
    suffix: string,
    codes: string[],
  ): Promise<{ adminId: string; roleId: string }> {
    const now = pgNow();
    const roleId = createUuidV7();
    await prisma.getDb().orm.public.Role.create({
      id: roleId,
      name: pgVarchar<128>(`reports-${suffix}`),
      description: null,
      active: true,
    });
    for (const code of codes) {
      const permission = await prisma
        .getDb()
        .orm.public.Permission.where({ code: pgVarchar<128>(code) })
        .first();
      let permissionId = permission?.id;
      if (!permissionId) {
        permissionId = createUuidV7();
        await prisma.getDb().orm.public.Permission.create({
          id: permissionId,
          code: pgVarchar<128>(code),
          description: null,
        });
      }
      await prisma.getDb().orm.public.RolePermission.create({
        roleId,
        permissionId,
      });
    }
    const adminId = createUuidV7();
    await prisma.getDb().orm.public.AdminProfile.create({
      id: adminId,
      accountId,
      roleId,
      displayName: pgVarchar<255>('Reports Admin'),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await permissions.invalidate(accountId);
    return { adminId, roleId };
  }

  async function cleanupByPhone(phoneE164: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    const account = await db.Account.where({ phone: phoneE164 }).first();
    if (!account) {
      return;
    }

    const admin = await db.AdminProfile.where({
      accountId: account.id,
    }).first();
    if (admin) {
      const roleId = admin.roleId;
      await db.AdminProfile.where({ id: admin.id }).delete();
      for (const rp of await db.RolePermission.where({ roleId }).all()) {
        await db.RolePermission.where({
          roleId: rp.roleId,
          permissionId: rp.permissionId,
        }).delete();
      }
      await db.Role.where({ id: roleId }).delete();
    }

    const customer = await db.CustomerProfile.where({
      accountId: account.id,
    }).first();
    if (customer) {
      for (const order of await db.Order.where({
        customerId: customer.id,
      }).all()) {
        await cleanupOrder(order.id);
      }
      await db.CustomerProfile.where({ id: customer.id }).delete();
    }

    for (const ticket of await db.SupportTicket.where({
      createdByAccountId: account.id,
    }).all()) {
      for (const msg of await db.SupportMessage.where({
        ticketId: ticket.id,
      }).all()) {
        await db.SupportMessage.where({ id: msg.id }).delete();
      }
      for (const note of await db.SupportInternalNote.where({
        ticketId: ticket.id,
      }).all()) {
        await db.SupportInternalNote.where({ id: note.id }).delete();
      }
      await db.SupportTicket.where({ id: ticket.id }).delete();
    }

    const driver = await db.DriverProfile.where({
      accountId: account.id,
    }).first();
    if (driver) {
      for (const earning of await db.DriverEarning.where({
        driverId: driver.id,
      }).all()) {
        await db.DriverEarning.where({ id: earning.id }).delete();
      }
      for (const collection of await db.CodCollection.where({
        driverId: driver.id,
      }).all()) {
        for (const alloc of await db.CodRemittanceAllocation.where({
          collectionId: collection.id,
        }).all()) {
          await db.CodRemittanceAllocation.where({ id: alloc.id }).delete();
        }
        await db.CodCollection.where({ id: collection.id }).delete();
      }
      for (const remittance of await db.CodRemittance.where({
        driverId: driver.id,
      }).all()) {
        const disc = await db.CodDiscrepancy.where({
          remittanceId: remittance.id,
        }).first();
        if (disc) {
          await db.CodDiscrepancy.where({ id: disc.id }).delete();
        }
        for (const alloc of await db.CodRemittanceAllocation.where({
          remittanceId: remittance.id,
        }).all()) {
          await db.CodRemittanceAllocation.where({ id: alloc.id }).delete();
        }
        await db.CodRemittance.where({ id: remittance.id }).delete();
      }
      for (const rating of await db.DriverRating.where({
        driverId: driver.id,
      }).all()) {
        await db.DriverRating.where({ id: rating.id }).delete();
      }
      await db.DriverProfile.where({ id: driver.id }).delete();
    }

    for (const membership of await db.MerchantMember.where({
      accountId: account.id,
    }).all()) {
      const merchantId = membership.merchantId;
      await db.MerchantMember.where({ id: membership.id }).delete();
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
      for (const rating of await db.MerchantRating.where({
        merchantId,
      }).all()) {
        await db.MerchantRating.where({ id: rating.id }).delete();
      }
      for (const branch of await db.MerchantBranch.where({
        merchantId,
      }).all()) {
        for (const order of await db.Order.where({
          merchantBranchId: branch.id,
        }).all()) {
          await cleanupOrder(order.id);
        }
        await db.MerchantBranch.where({ id: branch.id }).delete();
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

  async function cleanupOrder(orderId: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    for (const row of await db.DriverRating.where({ orderId }).all()) {
      await db.DriverRating.where({ id: row.id }).delete();
    }
    for (const row of await db.MerchantRating.where({ orderId }).all()) {
      await db.MerchantRating.where({ id: row.id }).delete();
    }
    for (const refund of await db.Refund.where({ orderId }).all()) {
      await db.Refund.where({ id: refund.id }).delete();
    }
    const payment = await db.Payment.where({ orderId }).first();
    if (payment) {
      for (const tx of await db.PaymentTransaction.where({
        paymentId: payment.id,
      }).all()) {
        await db.PaymentTransaction.where({ id: tx.id }).delete();
      }
      await db.Payment.where({ id: payment.id }).delete();
    }
    const collection = await db.CodCollection.where({ orderId }).first();
    if (collection) {
      for (const alloc of await db.CodRemittanceAllocation.where({
        collectionId: collection.id,
      }).all()) {
        await db.CodRemittanceAllocation.where({ id: alloc.id }).delete();
      }
      await db.CodCollection.where({ id: collection.id }).delete();
    }
    const delivery = await db.Delivery.where({ orderId }).first();
    if (delivery) {
      const earning = await db.DriverEarning.where({
        deliveryId: delivery.id,
      }).first();
      if (earning) {
        await db.DriverEarning.where({ id: earning.id }).delete();
      }
      for (const a of await db.DriverAssignment.where({
        deliveryId: delivery.id,
      }).all()) {
        await db.DriverAssignment.where({ id: a.id }).delete();
      }
      await db.Delivery.where({ id: delivery.id }).delete();
    }
    await db.OrderFinancialSnapshot.where({ orderId }).delete();
    await db.Order.where({ id: orderId }).delete();
  }

  it('enforces permissions, time bounds, snapshot finance, and privacy', async () => {
    const suffix = Date.now().toString().slice(-6);
    const server = app.getHttpServer();
    await deactivateAllDeliveryZones(prisma);
    await deactivateOpenGlobalCommissionDefaults(prisma);

    const opsToken = await authenticate(`0581${suffix}`);
    const financeToken = await authenticate(`0582${suffix}`);
    const civilianToken = await authenticate(`0583${suffix}`);
    const ownerToken = await authenticate(`0584${suffix}`);
    const customerToken = await authenticate(`0585${suffix}`);
    const driverToken = await authenticate(`0586${suffix}`);

    const opsAcct = await authMe(opsToken);
    const financeAcct = await authMe(financeToken);
    await authMe(ownerToken);
    const customerAcct = await authMe(customerToken);
    const driverAcct = await authMe(driverToken);

    await seedAdminWithPermissions(opsAcct.id, `ops-${suffix}`, [
      ADMIN_PERMISSIONS.REPORTS_READ,
    ]);
    const { adminId } = await seedAdminWithPermissions(
      financeAcct.id,
      `fin-${suffix}`,
      [ADMIN_PERMISSIONS.REPORTS_FINANCE_READ, ADMIN_PERMISSIONS.REPORTS_READ],
    );

    // Unique 7-day window far in the future (avoids Date overflow from huge week offsets).
    const dayOffset = Number(suffix) % 10_000;
    const fromMs = Date.UTC(2080, 0, 1) + dayOffset * 24 * 60 * 60 * 1000;
    const from = new Date(fromMs).toISOString();
    const to = new Date(fromMs + 7 * 24 * 60 * 60 * 1000).toISOString();
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

    const tInside = pgTimestamptz(
      new Date(fromMs + 2 * 24 * 60 * 60 * 1000).toISOString(),
    );
    const tFrom = pgTimestamptz(from);
    const tTo = pgTimestamptz(to);
    const tBefore = pgTimestamptz(new Date(fromMs - 60_000).toISOString());

    const civilianOps = await request(server)
      .get(`/api/v1/admin/reports/operations/orders?${q}`)
      .set('Authorization', `Bearer ${civilianToken}`);
    expect(civilianOps.status).toBe(403);

    const opsOk = await request(server)
      .get(`/api/v1/admin/reports/operations/orders?${q}`)
      .set('Authorization', `Bearer ${opsToken}`);
    expect(opsOk.status).toBe(200);

    const opsFinanceDenied = await request(server)
      .get(`/api/v1/admin/reports/finance/payments?${q}`)
      .set('Authorization', `Bearer ${opsToken}`);
    expect(opsFinanceDenied.status).toBe(403);

    const financeOk = await request(server)
      .get(`/api/v1/admin/reports/finance/payments?${q}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(financeOk.status).toBe(200);

    const codBaseline = await request(server)
      .get(`/api/v1/admin/reports/finance/cod?${q}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(codBaseline.status).toBe(200);
    const baselineOutstanding = BigInt(
      String(
        (codBaseline.body as { codOutstandingCustodyAsOfToMinor: string })
          .codOutstandingCustodyAsOfToMinor,
      ),
    );

    const badWindow = await request(server)
      .get(
        `/api/v1/admin/reports/operations/orders?from=${encodeURIComponent('2020-01-01T00:00:00.000Z')}&to=${encodeURIComponent('2026-01-01T00:00:00.000Z')}`,
      )
      .set('Authorization', `Bearer ${opsToken}`);
    expect(badWindow.status).toBe(400);
    expect((badWindow.body as ErrorBody).error.code).toBe(
      'REPORTS_INVALID_INPUT',
    );

    const bareDate = await request(server)
      .get(
        `/api/v1/admin/reports/operations/orders?from=2026-03-01&to=2026-03-08`,
      )
      .set('Authorization', `Bearer ${opsToken}`);
    expect(bareDate.status).toBe(400);

    await request(server)
      .post('/api/v1/customer/profile')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'Reports Customer' });
    const customerProfile = await prisma
      .getDb()
      .orm.public.CustomerProfile.where({ accountId: customerAcct.id })
      .first();

    const merchantRes = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Reports Shop ${suffix}` });
    expect(merchantRes.status).toBe(201);
    const merchantId = (merchantRes.body as { merchantId: string }).merchantId;
    const branchRes = await request(server)
      .post(`/api/v1/merchant/${merchantId}/branches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Main',
        phone: `0558${suffix}`,
        addressText: 'Pickup',
        latitude: 36.75,
        longitude: 3.05,
      });
    expect(branchRes.status).toBe(201);
    const branchId = (branchRes.body as { id: string }).id;

    const now = pgNow();
    const zoneId = createUuidV7();
    await prisma.getDb().orm.public.DeliveryZone.create({
      id: zoneId,
      name: pgVarchar<255>(`Reports zone ${suffix}`),
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

    const pricingRuleId = createUuidV7();
    await prisma.getDb().orm.public.DeliveryPricingRule.create({
      id: pricingRuleId,
      zoneId,
      name: pgVarchar<255>(`Reports pricing ${suffix}`),
      timeBand: 'DAY',
      startLocalTime: null,
      endLocalTime: null,
      customerDeliveryFeeMinor: pgBigInt(200),
      driverRemunerationMinor: pgBigInt(150),
      effectiveFrom: pgTimestamptz('2020-01-01T00:00:00.000Z'),
      effectiveTo: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    pricingRuleIds.push(pricingRuleId);

    const commissionRuleId = createUuidV7();
    await prisma.getDb().orm.public.MerchantCommissionRule.create({
      id: commissionRuleId,
      scope: 'GLOBAL_DEFAULT',
      merchantId: null,
      rateBps: 1000,
      effectiveFrom: pgTimestamptz('2020-01-01T00:00:00.000Z'),
      effectiveTo: null,
      changeReason: null,
      changedByAdminId: adminId,
      active: true,
      createdAt: now,
    });
    commissionRuleIds.push(commissionRuleId);

    const driverId = createUuidV7();
    await prisma.getDb().orm.public.DriverProfile.create({
      id: driverId,
      accountId: driverAcct.id,
      fullName: pgVarchar<255>('Reports Driver'),
      verificationStatus: pgVarchar<64>('APPROVED'),
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    async function seedOrder(opts: {
      status: string;
      createdAt: string;
      completedAt: string | null;
      gms: number;
      commission: number;
      merchantNet: number;
      merchantDiscount?: number;
      platformDiscount?: number;
      withDelivery?: boolean;
      withPayment?: {
        status: string;
        /** Authoritative success event time for ELECTRONIC (PaymentTransaction.processedAt). */
        successAt: string;
        /** Aggregate updatedAt — may differ from successAt (lockPayment bump). */
        updatedAt: string;
        amount: number;
      };
      withRefund?: {
        status: string;
        completedAt: string | null;
        amount: number;
      };
      withEarning?: number;
      withCod?: number;
    }): Promise<string> {
      const orderId = createUuidV7();
      await prisma.getDb().orm.public.Order.create({
        id: orderId,
        publicReference: pgVarchar<64>(
          `sgo_rp_${orderId.replace(/-/g, '').slice(0, 20)}`,
        ),
        customerId: customerProfile!.id,
        merchantBranchId: branchId,
        deliveryZoneId: zoneId,
        status: opts.status as never,
        fulfillmentStatus: 'READY',
        createdAt: opts.createdAt as never,
        confirmedAt: opts.createdAt as never,
        completedAt: opts.completedAt as never,
        updatedAt: opts.createdAt as never,
      });
      await prisma.getDb().orm.public.OrderFinancialSnapshot.create({
        orderId,
        currency: pgChar<3>('DZD'),
        grossMerchandiseSubtotalMinor: pgBigInt(opts.gms),
        merchantDiscountMinor: pgBigInt(opts.merchantDiscount ?? 0),
        platformDiscountMinor: pgBigInt(opts.platformDiscount ?? 0),
        totalDiscountMinor: pgBigInt(
          (opts.merchantDiscount ?? 0) + (opts.platformDiscount ?? 0),
        ),
        commissionBaseMinor: pgBigInt(opts.gms),
        merchantCommissionRateBps: 1000,
        merchantCommissionAmountMinor: pgBigInt(opts.commission),
        merchantNetAmountMinor: pgBigInt(opts.merchantNet),
        customerDeliveryFeeMinor: pgBigInt(200),
        driverRemunerationMinor: pgBigInt(150),
        speedyGoDeliveryShareMinor: pgBigInt(50),
        serviceFeeMinor: pgBigInt(0),
        customerPayableMinor: pgBigInt(opts.gms + 200),
        commissionRuleId,
        pricingRuleId,
        createdAt: opts.createdAt as never,
      });
      if (opts.withPayment) {
        const paymentId = createUuidV7();
        await prisma.getDb().orm.public.Payment.create({
          id: paymentId,
          orderId,
          method: pgVarchar<64>('ELECTRONIC'),
          status: opts.withPayment.status as never,
          amountMinor: pgBigInt(opts.withPayment.amount),
          currency: pgChar<3>('DZD'),
          createdAt: opts.withPayment.successAt as never,
          updatedAt: opts.withPayment.updatedAt as never,
        });
        if (opts.withPayment.status === 'SUCCEEDED') {
          await prisma.getDb().orm.public.PaymentTransaction.create({
            id: createUuidV7(),
            paymentId,
            provider: pgVarchar<64>('test'),
            providerReference: pgVarchar<255>(`ref_${paymentId.slice(0, 8)}`),
            status: pgVarchar<64>('SUCCEEDED'),
            amountMinor: pgBigInt(opts.withPayment.amount),
            idempotencyKey: pgVarchar<128>(`idem_${paymentId}`),
            processedAt: opts.withPayment.successAt as never,
            createdAt: opts.withPayment.successAt as never,
          });
        }
      }
      if (opts.withRefund) {
        await prisma.getDb().orm.public.Refund.create({
          id: createUuidV7(),
          orderId,
          paymentTransactionId: null,
          refundMethod: 'MANUAL_OTHER',
          amountMinor: pgBigInt(opts.withRefund.amount),
          status: opts.withRefund.status as never,
          reason: pgVarchar<255>('reports-e2e'),
          internalNote: null,
          requestedByAdminId: adminId,
          requestedAt: tInside,
          completedAt: opts.withRefund.completedAt as never,
          createdAt: tInside,
        });
      }
      if (
        opts.withDelivery ||
        opts.withEarning != null ||
        opts.withCod != null
      ) {
        const deliveryId = createUuidV7();
        await prisma.getDb().orm.public.Delivery.create({
          id: deliveryId,
          orderId,
          status: 'DELIVERED',
          driverSearchStartedAt: opts.completedAt ?? opts.createdAt,
          deliveredAt: (opts.completedAt ?? opts.createdAt) as never,
          createdAt: (opts.completedAt ?? opts.createdAt) as never,
          updatedAt: (opts.completedAt ?? opts.createdAt) as never,
        });
        await prisma.getDb().orm.public.DriverAssignment.create({
          id: createUuidV7(),
          deliveryId,
          driverId,
          status: pgVarchar<64>('RELEASED'),
          assignedAt: (opts.completedAt ?? opts.createdAt) as never,
          acceptedAt: (opts.completedAt ?? opts.createdAt) as never,
          releasedAt: (opts.completedAt ?? opts.createdAt) as never,
        });
        if (opts.withEarning != null) {
          await prisma.getDb().orm.public.DriverEarning.create({
            id: createUuidV7(),
            deliveryId,
            driverId,
            baseRemunerationMinor: pgBigInt(opts.withEarning),
            bonusMinor: pgBigInt(0),
            adjustmentMinor: pgBigInt(0),
            netEarningMinor: pgBigInt(opts.withEarning),
            status: pgVarchar<64>('EARNED'),
            validatedAt: (opts.completedAt ?? opts.createdAt) as never,
            createdAt: (opts.completedAt ?? opts.createdAt) as never,
            updatedAt: (opts.completedAt ?? opts.createdAt) as never,
          });
        }
        if (opts.withCod != null) {
          await prisma.getDb().orm.public.CodCollection.create({
            id: createUuidV7(),
            orderId,
            driverId,
            expectedAmountMinor: pgBigInt(opts.withCod),
            collectedAmountMinor: pgBigInt(opts.withCod),
            collectedAt: (opts.completedAt ?? opts.createdAt) as never,
            status: pgVarchar<64>('COLLECTED'),
            createdAt: (opts.completedAt ?? opts.createdAt) as never,
          });
        }
      }
      return orderId;
    }

    const primaryCompletedOrderId = await seedOrder({
      status: 'COMPLETED',
      createdAt: tInside,
      completedAt: tInside,
      gms: 10000,
      commission: 1000,
      merchantNet: 9000,
      merchantDiscount: 100,
      platformDiscount: 200,
      withDelivery: true,
      withPayment: {
        status: 'SUCCEEDED',
        successAt: tInside,
        // Simulate lockPayment bump after success — must NOT move success cohort.
        updatedAt: tTo,
        amount: 10200,
      },
      withRefund: {
        status: 'REFUNDED',
        completedAt: tInside,
        amount: 500,
      },
      withEarning: 150,
      withCod: 10200,
    });

    // Prior-period COD custody on a separate Order (unique orderId on CodCollection).
    const priorCodOrderId = await seedOrder({
      status: 'COMPLETED',
      createdAt: tBefore,
      completedAt: tBefore,
      gms: 100,
      commission: 10,
      merchantNet: 90,
      withDelivery: true,
    });
    await prisma.getDb().orm.public.CodCollection.create({
      id: createUuidV7(),
      orderId: priorCodOrderId,
      driverId,
      expectedAmountMinor: pgBigInt(100),
      collectedAmountMinor: pgBigInt(100),
      collectedAt: tBefore,
      status: pgVarchar<64>('COLLECTED'),
      createdAt: tBefore,
    });

    await seedOrder({
      status: 'CANCELLED',
      createdAt: tInside,
      completedAt: null,
      gms: 5000,
      commission: 500,
      merchantNet: 4500,
    });
    await seedOrder({
      status: 'COMPLETED',
      createdAt: tBefore,
      completedAt: tTo,
      gms: 7777,
      commission: 777,
      merchantNet: 7000,
      withPayment: {
        status: 'SUCCEEDED',
        successAt: tTo,
        updatedAt: tTo,
        amount: 8000,
      },
      withRefund: {
        status: 'APPROVED',
        completedAt: null,
        amount: 999,
      },
    });
    await seedOrder({
      status: 'COMPLETED',
      createdAt: tFrom,
      completedAt: tFrom,
      gms: 3000,
      commission: 300,
      merchantNet: 2700,
      withPayment: {
        status: 'FAILED',
        successAt: tInside,
        updatedAt: tInside,
        amount: 3200,
      },
    });

    await prisma.getDb().orm.public.MerchantSettlement.create({
      id: createUuidV7(),
      merchantId,
      periodStart: pgTimestamptz(
        new Date(new Date(from).getTime() - 30 * 86400000).toISOString(),
      ),
      periodEnd: pgTimestamptz(from),
      grossSalesMinor: pgBigInt(10000),
      commissionMinor: pgBigInt(1000),
      refundAdjustmentsMinor: pgBigInt(0),
      manualAdjustmentsMinor: pgBigInt(0),
      netPayableMinor: pgBigInt(-250),
      status: pgVarchar<64>('FINALIZED'),
      paidAt: null,
      createdAt: tInside,
    });

    await prisma.getDb().orm.public.SupportTicket.create({
      id: createUuidV7(),
      publicReference: pgVarchar<64>(`spt_rp_${suffix}`),
      createdByAccountId: customerAcct.id,
      driverId: null,
      merchantId: null,
      orderId: null,
      status: pgVarchar<64>('OPEN'),
      priority: pgVarchar<32>('NORMAL'),
      assignedAdminId: null,
      createdAt: tInside,
      updatedAt: tInside,
    });

    await prisma.getDb().orm.public.DriverRating.create({
      id: createUuidV7(),
      orderId: primaryCompletedOrderId,
      customerId: customerProfile!.id,
      driverId,
      score: 5,
      comment: 'secret private comment must not appear in reports',
      createdAt: tInside,
    });

    const ordersReport = await request(server)
      .get(`/api/v1/admin/reports/operations/orders?${q}`)
      .set('Authorization', `Bearer ${opsToken}`);
    expect(ordersReport.status).toBe(200);
    expect(ordersReport.body).toMatchObject({
      ordersCreatedCount: 3,
      ordersCompletedCount: 2,
      ordersCancelledCount: 1,
      window: { interval: '[from, to)', timezone: 'UTC_INSTANTS' },
    });

    const deliveriesReport = await request(server)
      .get(`/api/v1/admin/reports/operations/deliveries?${q}`)
      .set('Authorization', `Bearer ${opsToken}`);
    expect(deliveriesReport.status).toBe(200);
    expect(deliveriesReport.body).toMatchObject({
      deliveriesDeliveredCount: 1,
    });

    const completedFinance = await request(server)
      .get(`/api/v1/admin/reports/finance/completed-orders?${q}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(completedFinance.status).toBe(200);
    expect(completedFinance.body).toMatchObject({
      completedOrderCount: 2,
      grossMerchandiseMinor: '13000',
      merchantCommissionMinor: '1300',
      merchantDiscountMinor: '100',
      platformDiscountMinor: '200',
      merchantNetMinor: '11700',
    });
    expect(JSON.stringify(completedFinance.body)).not.toMatch(
      /profit|platformRevenue|bankBalance|netProfit/i,
    );

    // Historical snapshot: change commission rule rate; report must stay on OFS.
    await prisma
      .getDb()
      .orm.public.MerchantCommissionRule.where({ id: commissionRuleId })
      .update({ rateBps: 5000 });
    const afterRuleChange = await request(server)
      .get(`/api/v1/admin/reports/finance/completed-orders?${q}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(afterRuleChange.body).toMatchObject({
      merchantCommissionMinor: '1300',
    });

    const payments = await request(server)
      .get(`/api/v1/admin/reports/finance/payments?${q}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(payments.body).toMatchObject({
      paymentSucceededDuringPeriodCount: 1,
      customerPaymentSucceededDuringPeriodMinor: '10200',
      successEventSource:
        'PAYMENT_TRANSACTION_PROCESSED_AT_OR_COD_COLLECTED_AT',
    });

    const refunds = await request(server)
      .get(`/api/v1/admin/reports/finance/refunds?${q}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(refunds.body).toMatchObject({
      refundCompletedCount: 1,
      customerRefundedMinor: '500',
    });

    const cod = await request(server)
      .get(`/api/v1/admin/reports/finance/cod?${q}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(cod.body).toMatchObject({
      codCollectedDuringPeriodCount: 1,
      codCollectedDuringPeriodMinor: '10200',
      codConfirmedRemittedDuringPeriodCount: 0,
      codConfirmedRemittedDuringPeriodMinor: '0',
      codCustodyNetMovementDuringPeriodMinor: '10200',
    });
    expect(
      BigInt(
        String(
          (cod.body as { codOutstandingCustodyAsOfToMinor: string })
            .codOutstandingCustodyAsOfToMinor,
        ),
      ) - baselineOutstanding,
    ).toBe(10300n);

    const earnings = await request(server)
      .get(`/api/v1/admin/reports/finance/driver-earnings?${q}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(earnings.body).toMatchObject({
      driverEarningRowCount: 1,
      driverEarnedMinor: '150',
    });

    const settlements = await request(server)
      .get(`/api/v1/admin/reports/finance/settlements?${q}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(settlements.body).toMatchObject({
      settlementsCreatedDuringPeriodCount: 1,
      settlementsCreatedCurrentlyFinalizedCount: 1,
      settlementsCreatedCurrentlyFinalizedNetPayableMinor: '-250',
    });
    expect(JSON.stringify(settlements.body)).not.toMatch(
      /finalizedDuringPeriod|settlementsFinalizedDuring/i,
    );

    const promotions = await request(server)
      .get(`/api/v1/admin/reports/finance/promotions?${q}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(promotions.body).toMatchObject({
      merchantFundedDiscountMinor: '100',
      platformFundedDiscountMinor: '200',
    });

    const merchants = await request(server)
      .get(`/api/v1/admin/reports/finance/merchants?${q}&limit=10&offset=0`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(merchants.status).toBe(200);
    expect(merchants.body).toMatchObject({
      total: 1,
      items: [
        {
          merchantId,
          completedOrderCount: 2,
          grossMerchandiseMinor: '13000',
        },
      ],
    });

    const drivers = await request(server)
      .get(`/api/v1/admin/reports/operations/drivers?${q}`)
      .set('Authorization', `Bearer ${opsToken}`);
    expect(drivers.body).toMatchObject({
      items: [{ driverId, completedDeliveryCount: 1 }],
    });

    const ratings = await request(server)
      .get(`/api/v1/admin/reports/operations/ratings?${q}`)
      .set('Authorization', `Bearer ${opsToken}`);
    expect(ratings.body).toMatchObject({
      driverRatingsCreatedCount: 1,
      driverRatingAverage: 5,
    });
    expect(JSON.stringify(ratings.body)).not.toContain('secret private');

    const support = await request(server)
      .get(`/api/v1/admin/reports/operations/support?${q}`)
      .set('Authorization', `Bearer ${opsToken}`);
    expect(support.body).toMatchObject({
      ticketsCreatedCount: 1,
      ticketsCreatedByStatus: { OPEN: 1 },
    });
    expect(JSON.stringify(support.body)).not.toMatch(/"body"|"message"/i);

    // No mutation: completed order count unchanged after report reads.
    const again = await request(server)
      .get(`/api/v1/admin/reports/finance/completed-orders?${q}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(again.body).toMatchObject({ completedOrderCount: 2 });
  });
});
