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
import { PermissionService } from '../src/modules/authorization/permission.service';
import { AdminAuditService } from '../src/modules/admin/application/admin-audit.service';
import { ADMIN_AUDIT_ACTIONS } from '../src/modules/admin/domain/admin-audit-actions';
import { adminAuditFailed } from '../src/modules/admin/domain/admin.errors';
import { ADMIN_PERMISSIONS } from '../src/modules/admin/domain/admin-permissions';
import { DriverReviewService } from '../src/modules/drivers/application/driver-review.service';
import { MatchingService } from '../src/modules/matching/application/matching.service';
import { MATCHING_QUEUE_NAME } from '../src/modules/matching/domain/matching.jobs';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '../src/modules/matching/domain/matching.types';
import { MatchingProcessor } from '../src/modules/matching/infrastructure/matching.processor';
import { REFUND_ERROR_CODES } from '../src/modules/refunds/domain/refund.errors';
import { REFUND_METHOD_MANUAL_OTHER } from '../src/modules/refunds/domain/refund.types';

type TokenBody = { accessToken: string };
type AuthMeBody = { account: { id: string; phone: string } };
type ErrorBody = { error: { code: string; message: string } };
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

/**
 * Admin Foundation finance HTTP e2e.
 * Fixture helpers are copied (not imported) from refunds.e2e-spec.ts patterns.
 */
describe('Admin Foundation Finance (e2e)', () => {
  jest.setTimeout(180_000);

  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let matching: MatchingService;
  let review: DriverReviewService;
  let locations: DriverLocationStore;
  let queue: Queue;
  let permissions: PermissionService;

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
    permissions = app.get(PermissionService);

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
        deviceName: 'admin-finance-e2e',
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

  async function seedFinanceAdmin(
    accountId: string,
    suffix: string,
  ): Promise<{ adminId: string; roleId: string }> {
    const now = pgNow();
    const roleId = createUuidV7();
    await prisma.getDb().orm.public.Role.create({
      id: roleId,
      name: pgVarchar<128>(`finance-admin-${suffix}`),
      description: null,
      active: true,
    });
    for (const code of [
      ADMIN_PERMISSIONS.REFUNDS_MANAGE,
      ADMIN_PERMISSIONS.REFUNDS_READ,
      ADMIN_PERMISSIONS.SETTLEMENTS_MANAGE,
      ADMIN_PERMISSIONS.SETTLEMENTS_READ,
      ADMIN_PERMISSIONS.COD_READ,
      ADMIN_PERMISSIONS.COD_REMITTANCE_CONFIRM,
      ADMIN_PERMISSIONS.AUDIT_READ,
    ]) {
      const existing = await prisma
        .getDb()
        .orm.public.Permission.where({ code: pgVarchar<128>(code) })
        .first();
      const permissionId = existing?.id ?? createUuidV7();
      if (!existing) {
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
      displayName: pgVarchar<255>('Finance Admin'),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await permissions.invalidate(accountId);
    return { adminId, roleId };
  }

  async function cleanupSettlementsForMerchant(
    merchantId: string,
  ): Promise<void> {
    const db = prisma.getDb().orm.public;
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
  }

  async function cleanupByPhone(phoneE164: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    const account = await db.Account.where({ phone: phoneE164 }).first();
    if (!account) return;

    const admin = await db.AdminProfile.where({
      accountId: account.id,
    }).first();
    if (admin) {
      for (const audit of await db.AuditLog.where({
        adminId: admin.id,
      }).all()) {
        await db.AuditLog.where({ id: audit.id }).delete();
      }
      for (const rule of await db.MerchantCommissionRule.where({
        changedByAdminId: admin.id,
      }).all()) {
        await db.MerchantCommissionRule.where({ id: rule.id }).delete();
      }
      const links = await db.RolePermission.where({
        roleId: admin.roleId,
      }).all();
      for (const link of links) {
        await db.RolePermission.where({
          roleId: link.roleId,
          permissionId: link.permissionId,
        }).delete();
      }
      await db.AdminProfile.where({ id: admin.id }).delete();
      await db.Role.where({ id: admin.roleId }).delete();
    }

    const driver = await db.DriverProfile.where({
      accountId: account.id,
    }).first();
    if (driver) {
      for (const remittance of await db.CodRemittance.where({
        driverId: driver.id,
      }).all()) {
        for (const allocation of await db.CodRemittanceAllocation.where({
          remittanceId: remittance.id,
        }).all()) {
          await db.CodRemittanceAllocation.where({
            id: allocation.id,
          }).delete();
        }
        const discrepancy = await db.CodDiscrepancy.where({
          remittanceId: remittance.id,
        }).first();
        if (discrepancy) {
          await db.CodDiscrepancy.where({ id: discrepancy.id }).delete();
        }
        const remittanceEntry = await db.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`COD_REMITTANCE:${remittance.id}`),
        }).first();
        if (remittanceEntry) {
          await db.FinancialLedgerEntry.where({
            id: remittanceEntry.id,
          }).delete();
        }
        await db.CodRemittance.where({ id: remittance.id }).delete();
      }
      for (const collection of await db.CodCollection.where({
        driverId: driver.id,
      }).all()) {
        const collectionEntry = await db.FinancialLedgerEntry.where({
          reference: pgVarchar<128>(`COD_COLLECTION:${collection.id}`),
        }).first();
        if (collectionEntry) {
          await db.FinancialLedgerEntry.where({
            id: collectionEntry.id,
          }).delete();
        }
        await db.CodCollection.where({ id: collection.id }).delete();
      }
      for (const entry of await db.FinancialLedgerEntry.where({
        driverId: driver.id,
      }).all()) {
        await db.FinancialLedgerEntry.where({ id: entry.id }).delete();
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
      const availability = await db.DriverAvailability.where({
        driverId: driver.id,
      }).first();
      if (availability) {
        await db.DriverAvailability.where({ driverId: driver.id }).delete();
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
          const collectionEntry = await db.FinancialLedgerEntry.where({
            reference: pgVarchar<128>(`COD_COLLECTION:${collection.id}`),
          }).first();
          if (collectionEntry) {
            await db.FinancialLedgerEntry.where({
              id: collectionEntry.id,
            }).delete();
          }
          await db.CodCollection.where({ id: collection.id }).delete();
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
        for (const line of await db.MerchantSettlementLine.where({
          orderId: order.id,
        }).all()) {
          await db.MerchantSettlementLine.where({ id: line.id }).delete();
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
    await deleteAccountNotificationArtifacts(prisma, account.id);
    await db.Account.where({ id: account.id }).delete();
  }

  type Fixture = {
    suffix: string;
    customerToken: string;
    ownerToken: string;
    driverToken: string;
    financeToken: string;
    driverId: string;
    merchantId: string;
    productId: string;
    addressId: string;
    phones: string[];
    zoneId: string;
    commissionAdminId: string;
    commissionRoleId: string;
    financeAdminId: string;
    financeRoleId: string;
  };

  async function createFixture(suffix: string): Promise<Fixture> {
    const server = app.getHttpServer();
    const rawPhones = [
      `0561${suffix}`,
      `0562${suffix}`,
      `0563${suffix}`,
      `0564${suffix}`,
    ];
    const tokens: string[] = [];
    for (const phone of rawPhones) {
      tokens.push(await authenticate(phone));
    }
    const [customerToken, ownerToken, driverToken, financeToken] = tokens;
    const accounts = await Promise.all(tokens.map((token) => authMe(token)));

    await request(server)
      .post('/api/v1/customer/profile')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'Finance Admin Customer' });
    const address = await request(server)
      .post('/api/v1/customer/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        label: 'Home',
        addressText: 'Finance dropoff',
        latitude: INSIDE[0],
        longitude: INSIDE[1],
      });
    expect(address.status).toBe(201);

    const merchant = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Finance Cafe ${suffix}` });
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
        name: 'Finance meal',
        priceMinor: 1200,
      });

    const now = pgNow();
    const zoneId = createUuidV7();
    await prisma.getDb().orm.public.DeliveryZone.create({
      id: zoneId,
      name: pgVarchar<255>(`Finance zone ${suffix}`),
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

    const commissionRoleId = createUuidV7();
    await prisma.getDb().orm.public.Role.create({
      id: commissionRoleId,
      name: pgVarchar<128>(`finance-comm-${suffix}`),
      description: null,
      active: true,
    });
    const commissionAdminId = createUuidV7();
    await prisma.getDb().orm.public.AdminProfile.create({
      id: commissionAdminId,
      accountId: accounts[1].id,
      roleId: commissionRoleId,
      displayName: pgVarchar<255>('Commission Admin'),
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
      changedByAdminId: commissionAdminId,
      active: true,
      createdAt: now,
    });

    const { adminId: financeAdminId, roleId: financeRoleId } =
      await seedFinanceAdmin(accounts[3].id, suffix);

    const driverId = await onboardApprovedDriver(
      driverToken,
      'Finance Driver',
      `FD${suffix}`,
    );
    await locations.upsert(driverId, 36.7504, 3.0504, new Date().toISOString());

    return {
      suffix,
      customerToken,
      ownerToken,
      driverToken,
      financeToken,
      driverId,
      merchantId,
      productId: (product.body as { id: string }).id,
      addressId: (address.body as { id: string }).id,
      phones: accounts.map((account) => account.phone),
      zoneId,
      commissionAdminId,
      commissionRoleId,
      financeAdminId,
      financeRoleId,
    };
  }

  async function cleanupFixture(fixture: Fixture): Promise<void> {
    const db = prisma.getDb().orm.public;
    await cleanupSettlementsForMerchant(fixture.merchantId);
    // Customer first so OrderFinancialSnapshot releases commission/pricing FKs.
    if (fixture.phones[0]) await cleanupByPhone(fixture.phones[0]);
    for (const rule of await db.MerchantCommissionRule.where({
      changedByAdminId: fixture.commissionAdminId,
    }).all()) {
      await db.MerchantCommissionRule.where({ id: rule.id }).delete();
    }
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
  ): Promise<{ orderId: string; paidMinor: number }> {
    const server = app.getHttpServer();
    const orderId = await createReadyOrder(fixture);
    await acceptAndArrive(fixture, orderId);
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
    return { orderId, paidMinor: Number(payment!.amountMinor) };
  }

  async function completeCodDeliveryWithDeclaredRemittance(
    fixture: Fixture,
  ): Promise<{ remittanceId: string; collectedMinor: number }> {
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
        paymentMethod: 'COD',
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
    await acceptAndArrive(fixture, orderId);
    const payment = await prisma
      .getDb()
      .orm.public.Payment.where({ orderId })
      .first();
    const collectedMinor = Number(payment!.amountMinor);
    const collected = await request(server)
      .post('/api/v1/driver/deliveries/current/collect-cod')
      .set('Authorization', `Bearer ${fixture.driverToken}`)
      .send({ collectedAmountMinor: collectedMinor });
    expect(collected.status).toBe(200);
    const completed = await request(server)
      .post('/api/v1/driver/deliveries/current/complete-delivery')
      .set('Authorization', `Bearer ${fixture.driverToken}`)
      .send({});
    expect(completed.status).toBe(200);
    const remittance = await request(server)
      .post('/api/v1/driver/cod/remittances')
      .set('Authorization', `Bearer ${fixture.driverToken}`)
      .send({ submittedAmountMinor: collectedMinor });
    expect(remittance.status).toBe(200);
    expect((remittance.body as { status: string }).status).toBe('DECLARED');
    return {
      remittanceId: (remittance.body as { remittanceId: string }).remittanceId,
      collectedMinor,
    };
  }

  it('refund HTTP create → approve → confirm-manual with audits', async () => {
    const suffix = Date.now().toString().slice(-6);
    let fixture: Fixture | undefined;
    const server = app.getHttpServer();
    try {
      fixture = await createFixture(suffix);
      const { orderId, paidMinor } = await completeElectronicDelivery(fixture);
      const amount = Math.min(500, paidMinor - 1);

      const created = await request(server)
        .post('/api/v1/admin/refunds')
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({
          orderId,
          amountMinor: amount,
          method: REFUND_METHOD_MANUAL_OTHER,
          reason: 'admin goodwill',
          internalNote: 'finance note',
        });
      expect(created.status).toBe(201);
      const refund = created.body as {
        id: string;
        status: string;
        requestedByAdminId: string;
      };
      expect(refund.requestedByAdminId).toBe(fixture.financeAdminId);
      expect(refund.status).toBe('REQUESTED');

      const approved = await request(server)
        .post(`/api/v1/admin/refunds/${refund.id}/approve`)
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({});
      expect(approved.status).toBe(201);
      expect((approved.body as { status: string }).status).toBe('APPROVED');

      const confirmed = await request(server)
        .post(`/api/v1/admin/refunds/${refund.id}/confirm-manual`)
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({ internalNote: 'paid out of band' });
      expect(confirmed.status).toBe(201);
      expect((confirmed.body as { status: string }).status).toBe('REFUNDED');

      for (const action of [
        ADMIN_AUDIT_ACTIONS.REFUND_CREATE,
        ADMIN_AUDIT_ACTIONS.REFUND_APPROVE,
        ADMIN_AUDIT_ACTIONS.REFUND_CONFIRM_MANUAL,
      ]) {
        const audits = await request(server)
          .get('/api/v1/admin/audit')
          .query({
            adminId: fixture.financeAdminId,
            action,
            targetId: refund.id,
          })
          .set('Authorization', `Bearer ${fixture.financeToken}`);
        expect(audits.status).toBe(200);
        expect((audits.body as { total: number }).total).toBeGreaterThanOrEqual(
          1,
        );
      }
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('rejects ORIGINAL_PAYMENT and blocks over-refund', async () => {
    const suffix = (Date.now() + 1).toString().slice(-6);
    let fixture: Fixture | undefined;
    const server = app.getHttpServer();
    try {
      fixture = await createFixture(suffix);
      const { orderId, paidMinor } = await completeElectronicDelivery(fixture);

      const original = await request(server)
        .post('/api/v1/admin/refunds')
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({
          orderId,
          amountMinor: 100,
          method: 'ORIGINAL_PAYMENT',
          reason: 'provider path',
        });
      expect(original.status).toBe(400);

      const full = await request(server)
        .post('/api/v1/admin/refunds')
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({
          orderId,
          amountMinor: paidMinor,
          method: REFUND_METHOD_MANUAL_OTHER,
          reason: 'full',
        });
      expect(full.status).toBe(201);
      const refundId = (full.body as { id: string }).id;
      await request(server)
        .post(`/api/v1/admin/refunds/${refundId}/approve`)
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({});
      await request(server)
        .post(`/api/v1/admin/refunds/${refundId}/confirm-manual`)
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({});

      const over = await request(server)
        .post('/api/v1/admin/refunds')
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({
          orderId,
          amountMinor: 1,
          method: REFUND_METHOD_MANUAL_OTHER,
          reason: 'over',
        });
      expect(over.status).toBeGreaterThanOrEqual(400);
      expect((over.body as ErrorBody).error.code).toBe(
        REFUND_ERROR_CODES.REFUND_INSUFFICIENT_REMAINING,
      );
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('audit failure on confirm-manual rolls back (Refund stays APPROVED)', async () => {
    const suffix = (Date.now() + 2).toString().slice(-6);
    let fixture: Fixture | undefined;
    const server = app.getHttpServer();
    const audit = app.get(AdminAuditService);
    let spy: jest.SpyInstance | undefined;
    try {
      fixture = await createFixture(suffix);
      const { orderId } = await completeElectronicDelivery(fixture);
      const created = await request(server)
        .post('/api/v1/admin/refunds')
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({
          orderId,
          amountMinor: 200,
          method: REFUND_METHOD_MANUAL_OTHER,
          reason: 'audit rollback',
        });
      const refundId = (created.body as { id: string }).id;
      await request(server)
        .post(`/api/v1/admin/refunds/${refundId}/approve`)
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({});

      spy = jest
        .spyOn(audit, 'recordInTx')
        .mockRejectedValueOnce(adminAuditFailed());
      const failed = await request(server)
        .post(`/api/v1/admin/refunds/${refundId}/confirm-manual`)
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({});
      expect(failed.status).toBe(500);
      expect((failed.body as ErrorBody).error.code).toBe('ADMIN_AUDIT_FAILED');

      const row = await prisma
        .getDb()
        .orm.public.Refund.where({ id: refundId })
        .first();
      expect(row?.status).toBe('APPROVED');
    } finally {
      spy?.mockRestore();
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('settlement open draft + build sale lines + finalize via Admin HTTP', async () => {
    const suffix = (Date.now() + 3).toString().slice(-6);
    let fixture: Fixture | undefined;
    const server = app.getHttpServer();
    try {
      fixture = await createFixture(suffix);
      await completeElectronicDelivery(fixture);

      const draft = await request(server)
        .post('/api/v1/admin/settlements')
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({
          merchantId: fixture.merchantId,
          periodStart: '2020-01-01T00:00:00.000Z',
          periodEnd: '2099-01-01T00:00:00.000Z',
        });
      expect(draft.status).toBe(201);
      const settlementId = (draft.body as { id: string }).id;

      const built = await request(server)
        .post(`/api/v1/admin/settlements/${settlementId}/build-sale-lines`)
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({});
      expect(built.status).toBe(201);
      expect((built.body as { added: number }).added).toBeGreaterThanOrEqual(1);

      const finalized = await request(server)
        .post(`/api/v1/admin/settlements/${settlementId}/finalize`)
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({});
      expect(finalized.status).toBe(201);
      expect((finalized.body as { status: string }).status).toBe('FINALIZED');
      expect((finalized.body as { paidAt: string | null }).paidAt).toBeNull();

      const audits = await request(server)
        .get('/api/v1/admin/audit')
        .query({
          adminId: fixture.financeAdminId,
          action: ADMIN_AUDIT_ACTIONS.SETTLEMENT_FINALIZE,
          targetId: settlementId,
        })
        .set('Authorization', `Bearer ${fixture.financeToken}`);
      expect(audits.status).toBe(200);
      expect((audits.body as { total: number }).total).toBeGreaterThanOrEqual(
        1,
      );
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });

  it('COD remittance Admin HTTP confirm + audit; permission isolation', async () => {
    const suffix = (Date.now() + 4).toString().slice(-6);
    let fixture: Fixture | undefined;
    const server = app.getHttpServer();
    try {
      fixture = await createFixture(suffix);
      const { remittanceId, collectedMinor } =
        await completeCodDeliveryWithDeclaredRemittance(fixture);

      const denied = await request(server)
        .post(`/api/v1/admin/cod/remittances/${remittanceId}/confirm`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`)
        .send({ confirmedAmountMinor: collectedMinor });
      expect(denied.status).toBe(403);

      const confirmed = await request(server)
        .post(`/api/v1/admin/cod/remittances/${remittanceId}/confirm`)
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({ confirmedAmountMinor: collectedMinor });
      expect(confirmed.status).toBe(201);
      expect((confirmed.body as { status: string }).status).toBe('CONFIRMED');

      const replay = await request(server)
        .post(`/api/v1/admin/cod/remittances/${remittanceId}/confirm`)
        .set('Authorization', `Bearer ${fixture.financeToken}`)
        .send({ confirmedAmountMinor: collectedMinor });
      expect([409, 400]).toContain(replay.status);

      const audits = await request(server)
        .get('/api/v1/admin/audit')
        .query({
          adminId: fixture.financeAdminId,
          action: ADMIN_AUDIT_ACTIONS.COD_REMITTANCE_CONFIRM,
          targetId: remittanceId,
        })
        .set('Authorization', `Bearer ${fixture.financeToken}`);
      expect(audits.status).toBe(200);
      expect((audits.body as { total: number }).total).toBeGreaterThanOrEqual(
        1,
      );
      expect(
        (audits.body as { items: Array<{ adminId: string }> }).items[0]
          ?.adminId,
      ).toBe(fixture.financeAdminId);
    } finally {
      if (fixture) await cleanupFixture(fixture);
    }
  });
});
