import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import jwt from 'jsonwebtoken';
import { io, type Socket } from 'socket.io-client';
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
import {
  attachRedisIoAdapter,
  RedisIoAdapter,
} from '../src/infrastructure/realtime/redis-io.adapter';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { PermissionService } from '../src/modules/authorization/permission.service';
import { ADMIN_AUDIT_ACTIONS } from '../src/modules/admin/domain/admin-audit-actions';
import { ADMIN_PERMISSIONS } from '../src/modules/admin/domain/admin-permissions';
import { MatchingService } from '../src/modules/matching/application/matching.service';
import { MATCHING_QUEUE_NAME } from '../src/modules/matching/domain/matching.jobs';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '../src/modules/matching/domain/matching.types';
import { MatchingProcessor } from '../src/modules/matching/infrastructure/matching.processor';
import {
  TRACKING_EVENT_ERROR,
  TRACKING_NAMESPACE,
} from '../src/modules/tracking/domain/tracking.events';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';
import {
  deleteBranchOpeningHours,
  ensureBranchOpeningHours,
} from './helpers/ensure-branch-opening-hours';
import { deactivateOpenGlobalCommissionDefaults } from './helpers/sanitize-commission-globals';
import { deactivateAllDeliveryZones } from './helpers/sanitize-delivery-zones';
import { sanitizeOpenMatchingState } from './helpers/sanitize-open-matching';

type TokenPair = { accessToken: string; refreshToken: string };
type ErrorBody = { error: { code: string; message: string } };
type AuthMeBody = { account: { id: string; phone: string; status?: string } };
type MembershipBody = {
  merchantId: string;
  merchant: { status: string };
};
type DriverMeBody = {
  profile: { id: string; verificationStatus: string } | null;
  availability: { status: string } | null;
};
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

const INSIDE: [number, number] = [36.75, 3.05];
const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

describe('P1-G Suspend + Session Revocation (e2e)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication<App>;
  let redisIoAdapter: RedisIoAdapter;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let permissions: PermissionService;
  let matching: MatchingService;
  let locations: DriverLocationStore;
  let queue: Queue;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    redisIoAdapter = attachRedisIoAdapter(app);
    await app.listen(0);
    baseUrl = await app.getUrl();
    sender = app.get(OTP_SENDER);
    prisma = app.get(PrismaService);
    await deactivateAllDeliveryZones(prisma);
    await sanitizeOpenMatchingState(prisma);
    redis = app.get(RedisService);
    permissions = app.get(PermissionService);
    matching = app.get(MatchingService);
    locations = app.get(DRIVER_LOCATION_STORE);
    queue = app.get<Queue>(getQueueToken(MATCHING_QUEUE_NAME));
    await queue.obliterate({ force: true });
    // Never delete live Socket.IO adapter keys.
    for (const pattern of [
      'auth:test:*',
      'matching:test:*',
      'bull:matching:test*',
      'tracking:test:*',
    ]) {
      const leftover = await redis.getClient().keys(pattern);
      if (leftover.length > 0) {
        await redis.getClient().del(...leftover);
      }
    }
  });

  afterAll(async () => {
    const settle = async (work: () => Promise<unknown>, ms: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          work().finally(() => {
            if (timer) {
              clearTimeout(timer);
            }
          }),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, ms);
          }),
        ]);
      } catch {
        if (timer) {
          clearTimeout(timer);
        }
      }
    };
    await settle(async () => {
      if (queue) {
        await queue.obliterate({ force: true });
      }
    }, 5_000);
    await settle(async () => {
      if (app) {
        await app.get(MatchingProcessor).worker.close();
      }
    }, 5_000);
    await settle(async () => {
      if (app) {
        await app.close();
      }
    }, 10_000);
    await settle(async () => {
      if (redisIoAdapter) {
        await redisIoAdapter.close();
      }
    }, 5_000);
  }, 30_000);

  async function authenticate(
    phone: string,
    deviceName: string,
  ): Promise<TokenPair> {
    const server = app.getHttpServer();
    // Clear OTP cooldown / hourly counters so multi-device auth on one phone works.
    const otpKeys = await redis.getClient().keys('auth:test:otp:*');
    if (otpKeys.length > 0) {
      await redis.getClient().del(...otpKeys);
    }
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
        deviceName,
      });
    expect(verified.status).toBe(200);
    const body = verified.body as TokenPair;
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    return body;
  }

  async function authMe(token: string): Promise<AuthMeBody['account']> {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return (response.body as AuthMeBody).account;
  }

  function sessionIdFromAccess(accessToken: string): string {
    const payload = jwt.decode(accessToken) as { sid?: string } | null;
    expect(payload?.sid).toBeTruthy();
    return payload!.sid!;
  }

  function sessCacheKey(sessionId: string): string {
    return `auth:test:sess:${sessionId}`;
  }

  async function seedWarmActiveSnap(sessionId: string): Promise<void> {
    await redis
      .getClient()
      .set(sessCacheKey(sessionId), JSON.stringify({ status: 'ACTIVE' }));
  }

  async function seedAdminWithPermissions(
    accountId: string,
    suffix: string,
    codes: string[],
    opts?: { roleName?: string; active?: boolean },
  ): Promise<{ adminId: string; roleId: string }> {
    const now = pgNow();
    const roleId = createUuidV7();
    await prisma.getDb().orm.public.Role.create({
      id: roleId,
      name: pgVarchar<128>(opts?.roleName ?? `suspend-e2e-${suffix}`),
      description: null,
      active: opts?.active ?? true,
    });
    for (const code of codes) {
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
      displayName: pgVarchar<255>('Suspend E2E Admin'),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await permissions.invalidate(accountId);
    return { adminId, roleId };
  }

  async function submitMerchantForReview(
    ownerToken: string,
    name: string,
  ): Promise<string> {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name });
    expect(created.status).toBe(201);
    const merchantId = (created.body as MembershipBody).merchantId;
    await request(server)
      .put(
        `/api/v1/merchant/${merchantId}/verification/documents/BUSINESS_IDENTITY`,
      )
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    await request(server)
      .put(
        `/api/v1/merchant/${merchantId}/verification/documents/BUSINESS_REGISTRATION`,
      )
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ expiryDate: '2099-01-01' });
    const submitted = await request(server)
      .post(`/api/v1/merchant/${merchantId}/verification/submit`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(submitted.status).toBe(200);
    return merchantId;
  }

  async function seedMembership(
    merchantId: string,
    accountId: string,
    role: 'MANAGER' | 'STAFF',
  ): Promise<void> {
    await prisma.getDb().orm.public.MerchantMember.create({
      id: createUuidV7(),
      merchantId,
      accountId,
      role: pgVarchar<64>(role),
      createdAt: pgNow(),
    });
  }

  async function onboardApprovedDriver(
    token: string,
    fullName: string,
    plate: string,
  ): Promise<string> {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/api/v1/driver/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName });
    expect(created.status).toBe(201);
    await request(server)
      .put('/api/v1/driver/documents/IDENTITY')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    await request(server)
      .put('/api/v1/driver/documents/DRIVING_LICENSE')
      .set('Authorization', `Bearer ${token}`)
      .send({ expiryDate: '2099-12-31' });
    const vehicle = await request(server)
      .post('/api/v1/driver/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'MOTORCYCLE',
        plateNumber: plate,
        model: 'NMAX',
        color: 'Black',
      });
    expect(vehicle.status).toBe(201);
    const submitted = await request(server)
      .post('/api/v1/driver/verification/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(submitted.status).toBe(200);
    return (submitted.body as DriverMeBody).profile!.id;
  }

  function connectTracking(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}${TRACKING_NAMESPACE}`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
      });
      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error('socket connect timeout'));
      }, 5000);
      socket.on('connect', () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.on('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function expectConnectFail(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}${TRACKING_NAMESPACE}`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error('expected connect_error'));
      }, 5000);
      socket.on('connect', () => {
        clearTimeout(timer);
        socket.disconnect();
        reject(new Error('socket connected with revoked token'));
      });
      socket.on('connect_error', () => {
        clearTimeout(timer);
        socket.disconnect();
        resolve();
      });
    });
  }

  async function cleanupMerchantsByIds(merchantIds: string[]): Promise<void> {
    const db = prisma.getDb().orm.public;
    for (const merchantId of merchantIds) {
      for (const doc of await db.MerchantDocument.where({
        merchantId,
      }).all()) {
        await db.MerchantDocument.where({ id: doc.id }).delete();
      }
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
  }

  async function cleanupZones(zoneIds: string[]): Promise<void> {
    const db = prisma.getDb().orm.public;
    for (const zoneId of zoneIds) {
      for (const rule of await db.DeliveryPricingRule.where({
        zoneId,
      }).all()) {
        await db.DeliveryPricingRule.where({ id: rule.id }).delete();
      }
      await db.DeliveryZone.where({ id: zoneId }).delete();
    }
  }

  async function deleteOrderGraph(orderId: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    const delivery = await db.Delivery.where({ orderId }).first();
    if (delivery) {
      for (const row of await db.DriverEarning.where({
        deliveryId: delivery.id,
      }).all()) {
        await db.DriverEarning.where({ id: row.id }).delete();
      }
      for (const event of await db.DeliveryEvent.where({
        deliveryId: delivery.id,
      }).all()) {
        await db.DeliveryEvent.where({ id: event.id }).delete();
      }
      for (const assignment of await db.DriverAssignment.where({
        deliveryId: delivery.id,
      }).all()) {
        await db.DriverAssignment.where({ id: assignment.id }).delete();
      }
      const proof = await db.DeliveryProof.where({
        deliveryId: delivery.id,
      }).first();
      if (proof) {
        await db.DeliveryProof.where({ id: proof.id }).delete();
      }
      await db.Delivery.where({ id: delivery.id }).delete();
    }
    for (const refund of await db.Refund.where({ orderId }).all()) {
      await db.Refund.where({ id: refund.id }).delete();
    }
    for (const row of await db.CodCollection.where({ orderId }).all()) {
      for (const allocation of await db.CodRemittanceAllocation.where({
        collectionId: row.id,
      }).all()) {
        await db.CodRemittanceAllocation.where({ id: allocation.id }).delete();
      }
      await db.CodCollection.where({ id: row.id }).delete();
    }
    for (const payment of await db.Payment.where({ orderId }).all()) {
      for (const tx of await db.PaymentTransaction.where({
        paymentId: payment.id,
      }).all()) {
        await db.PaymentTransaction.where({ id: tx.id }).delete();
      }
      await db.Payment.where({ id: payment.id }).delete();
    }
    for (const event of await db.OrderStatusEvent.where({ orderId }).all()) {
      await db.OrderStatusEvent.where({ id: event.id }).delete();
    }
    const cancellation = await db.OrderCancellation.where({ orderId }).first();
    if (cancellation) {
      await db.OrderCancellation.where({ id: cancellation.id }).delete();
    }
    for (const item of await db.OrderItem.where({ orderId }).all()) {
      for (const option of await db.OrderItemOption.where({
        orderItemId: item.id,
      }).all()) {
        await db.OrderItemOption.where({ id: option.id }).delete();
      }
      await db.OrderItem.where({ id: item.id }).delete();
    }
    await db.OrderFinancialSnapshot.where({ orderId }).delete();
    await db.OrderDeliveryAddressSnapshot.where({ orderId }).delete();
    for (const entry of await db.FinancialLedgerEntry.where({
      orderId,
    }).all()) {
      await db.FinancialLedgerEntry.where({ id: entry.id }).delete();
    }
    await db.Order.where({ id: orderId }).delete();
  }

  async function cleanupByPhone(phoneE164: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    const account = await db.Account.where({ phone: phoneE164 }).first();
    if (!account) {
      return;
    }

    const driver = await db.DriverProfile.where({
      accountId: account.id,
    }).first();
    if (driver) {
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
      for (const row of await db.Vehicle.where({
        driverId: driver.id,
      }).all()) {
        await db.Vehicle.where({ id: row.id }).delete();
      }
      for (const entry of await db.FinancialLedgerEntry.where({
        driverId: driver.id,
      }).all()) {
        await db.FinancialLedgerEntry.where({ id: entry.id }).delete();
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
      for (const order of await db.Order.where({
        customerId: customer.id,
      }).all()) {
        await deleteOrderGraph(order.id);
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

    const members = await db.MerchantMember.where({
      accountId: account.id,
    }).all();
    const merchantIds = [...new Set(members.map((row) => row.merchantId))];
    await cleanupMerchantsByIds(merchantIds);

    const admin = await db.AdminProfile.where({
      accountId: account.id,
    }).first();
    if (admin) {
      for (const rule of await db.MerchantCommissionRule.where({
        changedByAdminId: admin.id,
      }).all()) {
        await db.MerchantCommissionRule.where({ id: rule.id }).delete();
      }
      for (const audit of await db.AuditLog.where({
        adminId: admin.id,
      }).all()) {
        await db.AuditLog.where({ id: audit.id }).delete();
      }
      for (const link of await db.RolePermission.where({
        roleId: admin.roleId,
      }).all()) {
        await db.RolePermission.where({
          roleId: link.roleId,
          permissionId: link.permissionId,
        }).delete();
      }
      await db.AdminProfile.where({ id: admin.id }).delete();
      await db.Role.where({ id: admin.roleId }).delete();
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

  it('driver suspend revokes multi-device sessions, sockets, and blocks go-online', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      driver: `0571${suffix}`,
      admin: `0572${suffix}`,
    };
    const e164: string[] = [];
    let socket: Socket | undefined;
    try {
      const deviceA = await authenticate(phones.driver, 'driver-suspend-a');
      const account = await authMe(deviceA.accessToken);
      e164.push(account.phone);

      const driverId = await onboardApprovedDriver(
        deviceA.accessToken,
        'Suspend Driver',
        `SG ${suffix}`,
      );

      const adminTokens = await authenticate(phones.admin, 'admin-suspend-drv');
      const adminAccount = await authMe(adminTokens.accessToken);
      e164.push(adminAccount.phone);
      const { adminId } = await seedAdminWithPermissions(
        adminAccount.id,
        `drv-${suffix}`,
        [
          ADMIN_PERMISSIONS.DRIVERS_VERIFY,
          ADMIN_PERMISSIONS.DRIVERS_SUSPEND,
          ADMIN_PERMISSIONS.AUDIT_READ,
        ],
      );

      const approved = await request(server)
        .post(`/api/v1/admin/drivers/${driverId}/verification/approve`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(approved.status).toBe(201);

      const deviceB = await authenticate(phones.driver, 'driver-suspend-b');
      expect(deviceB.accessToken).not.toBe(deviceA.accessToken);

      const sessionA = sessionIdFromAccess(deviceA.accessToken);
      const sessionB = sessionIdFromAccess(deviceB.accessToken);
      expect(sessionA).not.toBe(sessionB);
      const sessionsBefore = await prisma
        .getDb()
        .orm.public.Session.where({ accountId: account.id })
        .all();
      const activeBefore = sessionsBefore.filter((row) => !row.revokedAt);
      expect(activeBefore.map((row) => row.id).sort()).toEqual(
        [sessionA, sessionB].sort(),
      );
      await seedWarmActiveSnap(sessionA);
      await seedWarmActiveSnap(sessionB);

      socket = await connectTracking(deviceA.accessToken);
      expect(socket.connected).toBe(true);

      const deliveryCountBefore = (
        await prisma
          .getDb()
          .orm.public.DriverAssignment.where({ driverId })
          .all()
      ).length;
      const earningCountBefore = (
        await prisma.getDb().orm.public.DriverEarning.where({ driverId }).all()
      ).length;

      const disconnectPromise = new Promise<{
        code?: string;
      }>((resolve) => {
        socket!.once(TRACKING_EVENT_ERROR, (payload: { code?: string }) => {
          resolve(payload);
        });
        socket!.once('disconnect', () => {
          resolve({});
        });
      });

      const suspended = await request(server)
        .post(`/api/v1/admin/drivers/${driverId}/suspend`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(suspended.status).toBe(201);
      expect(suspended.body).toMatchObject({
        id: driverId,
        verificationStatus: 'SUSPENDED',
      });

      const sessionsAfter = await prisma
        .getDb()
        .orm.public.Session.where({ accountId: account.id })
        .all();
      expect(
        sessionsAfter.map((row) => ({
          id: row.id,
          revoked: Boolean(row.revokedAt),
        })),
      ).toEqual(
        expect.arrayContaining([
          { id: sessionA, revoked: true },
          { id: sessionB, revoked: true },
        ]),
      );
      expect(sessionsAfter).toHaveLength(2);

      const meAfter = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${deviceA.accessToken}`);
      // Access must fail with session revocation (not soft domain read).
      expect(meAfter.status).toBe(401);
      expect((meAfter.body as ErrorBody).error.code).toBe(
        'AUTH_SESSION_REVOKED',
      );

      const meB = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${deviceB.accessToken}`);
      expect(meB.status).toBe(401);
      expect((meB.body as ErrorBody).error.code).toBe('AUTH_SESSION_REVOKED');

      // Warm ACTIVE snap must not authorize after DB revoke.
      await seedWarmActiveSnap(sessionA);
      const warmDenied = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${deviceA.accessToken}`);
      expect(warmDenied.status).toBe(401);
      expect((warmDenied.body as ErrorBody).error.code).toBe(
        'AUTH_SESSION_REVOKED',
      );

      const refreshA = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: deviceA.refreshToken });
      expect(refreshA.status).toBe(401);
      expect((refreshA.body as ErrorBody).error.code).toBe(
        'AUTH_SESSION_REVOKED',
      );
      const refreshB = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: deviceB.refreshToken });
      expect(refreshB.status).toBe(401);
      expect((refreshB.body as ErrorBody).error.code).toBe(
        'AUTH_SESSION_REVOKED',
      );

      await disconnectPromise;
      expect(socket.connected).toBe(false);
      await expectConnectFail(deviceA.accessToken);

      const profile = await prisma
        .getDb()
        .orm.public.DriverProfile.where({ id: driverId })
        .first();
      expect(profile?.verificationStatus).toBe('SUSPENDED');
      const availability = await prisma
        .getDb()
        .orm.public.DriverAvailability.where({ driverId })
        .first();
      expect(availability?.status).toBe('SUSPENDED');

      const accountRow = await prisma
        .getDb()
        .orm.public.Account.where({ id: account.id })
        .first();
      expect(accountRow?.status).toBe('ACTIVE');

      const deliveryCountAfter = (
        await prisma
          .getDb()
          .orm.public.DriverAssignment.where({ driverId })
          .all()
      ).length;
      const earningCountAfter = (
        await prisma.getDb().orm.public.DriverEarning.where({ driverId }).all()
      ).length;
      expect(deliveryCountAfter).toBe(deliveryCountBefore);
      expect(earningCountAfter).toBe(earningCountBefore);

      const audits = await request(server)
        .get('/api/v1/admin/audit')
        .query({
          adminId,
          action: ADMIN_AUDIT_ACTIONS.DRIVER_SUSPEND,
          targetId: driverId,
        })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);
      expect(audits.status).toBe(200);
      const auditBody = audits.body as {
        items: Array<{ afterJson: { sessionsRevoked?: number } | null }>;
      };
      expect(auditBody.items[0]?.afterJson).toMatchObject({
        sessionsRevoked: 2,
        affectedAccountCount: 1,
        verificationStatus: 'SUSPENDED',
      });

      // Fresh OTP still creates a session (Account ACTIVE) but domain stays suspended.
      const fresh = await authenticate(phones.driver, 'driver-suspend-fresh');
      const freshMe = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${fresh.accessToken}`);
      expect(freshMe.status).toBe(200);
      expect((freshMe.body as DriverMeBody).profile?.verificationStatus).toBe(
        'SUSPENDED',
      );
      expect((freshMe.body as DriverMeBody).availability?.status).toBe(
        'SUSPENDED',
      );
      const goOnline = await request(server)
        .post('/api/v1/driver/availability/go-online')
        .set('Authorization', `Bearer ${fresh.accessToken}`)
        .send({});
      expect(goOnline.status).toBe(409);
      expect((goOnline.body as ErrorBody).error.code).toBe(
        'DRIVER_NOT_APPROVED',
      );
    } finally {
      if (socket) {
        socket.disconnect();
      }
      for (const phone of e164.reverse()) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('merchant suspend revokes all member sessions and preserves boundaries', async () => {
    const server = app.getHttpServer();
    const suffix = (Date.now() + 1).toString().slice(-6);
    const phones = {
      owner: `0573${suffix}`,
      manager: `0574${suffix}`,
      other: `0575${suffix}`,
      admin: `0576${suffix}`,
    };
    const e164: string[] = [];
    const merchantIds: string[] = [];
    try {
      const ownerTokens = await authenticate(phones.owner, 'merchant-owner-a');
      const owner = await authMe(ownerTokens.accessToken);
      e164.push(owner.phone);

      const managerTokens = await authenticate(
        phones.manager,
        'merchant-manager-a',
      );
      const manager = await authMe(managerTokens.accessToken);
      e164.push(manager.phone);

      const otherTokens = await authenticate(phones.other, 'merchant-other-a');
      const other = await authMe(otherTokens.accessToken);
      e164.push(other.phone);

      const adminTokens = await authenticate(
        phones.admin,
        'admin-suspend-merch',
      );
      const adminAccount = await authMe(adminTokens.accessToken);
      e164.push(adminAccount.phone);
      const { adminId } = await seedAdminWithPermissions(
        adminAccount.id,
        `mer-${suffix}`,
        [
          ADMIN_PERMISSIONS.MERCHANTS_VERIFY,
          ADMIN_PERMISSIONS.MERCHANTS_SUSPEND,
          ADMIN_PERMISSIONS.AUDIT_READ,
        ],
      );

      const customerProfile = await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ fullName: 'Owner Also Customer' });
      expect(customerProfile.status).toBe(201);

      const merchantId = await submitMerchantForReview(
        ownerTokens.accessToken,
        `Suspend Cafe ${suffix}`,
      );
      merchantIds.push(merchantId);
      await seedMembership(merchantId, manager.id, 'MANAGER');

      const otherMerchantId = await submitMerchantForReview(
        otherTokens.accessToken,
        `Other Cafe ${suffix}`,
      );
      merchantIds.push(otherMerchantId);

      const approveTarget = await request(server)
        .post(`/api/v1/admin/merchants/${merchantId}/verification/approve`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(approveTarget.status).toBe(201);

      const approveOther = await request(server)
        .post(`/api/v1/admin/merchants/${otherMerchantId}/verification/approve`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(approveOther.status).toBe(201);

      const ownerDeviceB = await authenticate(phones.owner, 'merchant-owner-b');
      const managerDeviceB = await authenticate(
        phones.manager,
        'merchant-manager-b',
      );

      const memberCountBefore = (
        await prisma
          .getDb()
          .orm.public.MerchantMember.where({ merchantId })
          .all()
      ).length;
      expect(memberCountBefore).toBe(2);

      const suspended = await request(server)
        .post(`/api/v1/admin/merchants/${merchantId}/suspend`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(suspended.status).toBe(201);
      expect(suspended.body).toMatchObject({
        id: merchantId,
        status: 'SUSPENDED',
      });

      for (const token of [
        ownerTokens.accessToken,
        ownerDeviceB.accessToken,
        managerTokens.accessToken,
        managerDeviceB.accessToken,
      ]) {
        const denied = await request(server)
          .get('/api/v1/merchant/me')
          .set('Authorization', `Bearer ${token}`);
        expect(denied.status).toBe(401);
        expect((denied.body as ErrorBody).error.code).toBe(
          'AUTH_SESSION_REVOKED',
        );
      }

      const otherStillOk = await request(server)
        .get('/api/v1/merchant/me')
        .set('Authorization', `Bearer ${otherTokens.accessToken}`);
      expect(otherStillOk.status).toBe(200);
      const otherMe = otherStillOk.body as {
        memberships: Array<{
          merchantId: string;
          merchant: { status: string };
        }>;
      };
      const otherMembership = otherMe.memberships.find(
        (row) => row.merchantId === otherMerchantId,
      );
      expect(otherMembership?.merchant.status).toBe('ACTIVE');

      const membersAfter = await prisma
        .getDb()
        .orm.public.MerchantMember.where({ merchantId })
        .all();
      expect(membersAfter).toHaveLength(2);

      const customerStill = await prisma
        .getDb()
        .orm.public.CustomerProfile.where({ accountId: owner.id })
        .first();
      expect(customerStill).toBeTruthy();

      const ownerAccount = await prisma
        .getDb()
        .orm.public.Account.where({ id: owner.id })
        .first();
      expect(ownerAccount?.status).toBe('ACTIVE');

      const audits = await request(server)
        .get('/api/v1/admin/audit')
        .query({
          adminId,
          action: ADMIN_AUDIT_ACTIONS.MERCHANT_SUSPEND,
          targetId: merchantId,
        })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);
      expect(audits.status).toBe(200);
      const auditBody = audits.body as {
        items: Array<{ afterJson: { sessionsRevoked?: number } | null }>;
      };
      expect(auditBody.items[0]?.afterJson).toMatchObject({
        sessionsRevoked: 4,
        affectedAccountCount: 2,
        status: 'SUSPENDED',
      });

      const freshOwner = await authenticate(
        phones.owner,
        'merchant-owner-fresh',
      );
      const mutate = await request(server)
        .patch(`/api/v1/merchant/${merchantId}/profile`)
        .set('Authorization', `Bearer ${freshOwner.accessToken}`)
        .send({ name: 'Should Fail' });
      expect(mutate.status).toBe(409);
      expect((mutate.body as ErrorBody).error.code).toBe(
        'MERCHANT_STATUS_RESTRICTED',
      );
    } finally {
      await cleanupMerchantsByIds(merchantIds);
      for (const phone of e164.reverse()) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('denies suspend without exact permission codes (Role.name non-authoritative)', async () => {
    const server = app.getHttpServer();
    const suffix = (Date.now() + 2).toString().slice(-6);
    const phones = {
      owner: `0577${suffix}`,
      driver: `0578${suffix}`,
      superNamed: `0579${suffix}`,
      verifyOnly: `0580${suffix}`,
    };
    const e164: string[] = [];
    const merchantIds: string[] = [];
    try {
      const ownerTokens = await authenticate(phones.owner, 'perm-owner');
      e164.push((await authMe(ownerTokens.accessToken)).phone);

      const driverTokens = await authenticate(phones.driver, 'perm-driver');
      const driverAccount = await authMe(driverTokens.accessToken);
      e164.push(driverAccount.phone);

      const superTokens = await authenticate(phones.superNamed, 'perm-super');
      const superAccount = await authMe(superTokens.accessToken);
      e164.push(superAccount.phone);
      await seedAdminWithPermissions(
        superAccount.id,
        `super-${suffix}`,
        [ADMIN_PERMISSIONS.MERCHANTS_READ],
        { roleName: 'SUPER_ADMIN' },
      );

      const verifyTokens = await authenticate(phones.verifyOnly, 'perm-verify');
      const verifyAccount = await authMe(verifyTokens.accessToken);
      e164.push(verifyAccount.phone);
      await seedAdminWithPermissions(verifyAccount.id, `ver-${suffix}`, [
        ADMIN_PERMISSIONS.DRIVERS_VERIFY,
        ADMIN_PERMISSIONS.MERCHANTS_VERIFY,
      ]);

      const merchantId = await submitMerchantForReview(
        ownerTokens.accessToken,
        `Perm Cafe ${suffix}`,
      );
      merchantIds.push(merchantId);

      const approve = await request(server)
        .post(`/api/v1/admin/merchants/${merchantId}/verification/approve`)
        .set('Authorization', `Bearer ${verifyTokens.accessToken}`)
        .send({});
      expect(approve.status).toBe(201);

      const driverId = await onboardApprovedDriver(
        driverTokens.accessToken,
        'Perm Driver',
        `PM ${suffix}`,
      );
      const approveDriver = await request(server)
        .post(`/api/v1/admin/drivers/${driverId}/verification/approve`)
        .set('Authorization', `Bearer ${verifyTokens.accessToken}`)
        .send({});
      expect(approveDriver.status).toBe(201);

      const superSuspendMerchant = await request(server)
        .post(`/api/v1/admin/merchants/${merchantId}/suspend`)
        .set('Authorization', `Bearer ${superTokens.accessToken}`)
        .send({});
      expect(superSuspendMerchant.status).toBe(403);
      expect((superSuspendMerchant.body as ErrorBody).error.code).toBe(
        'AUTH_FORBIDDEN',
      );

      const verifyCannotSuspendMerchant = await request(server)
        .post(`/api/v1/admin/merchants/${merchantId}/suspend`)
        .set('Authorization', `Bearer ${verifyTokens.accessToken}`)
        .send({});
      expect(verifyCannotSuspendMerchant.status).toBe(403);
      expect((verifyCannotSuspendMerchant.body as ErrorBody).error.code).toBe(
        'AUTH_FORBIDDEN',
      );

      const verifyCannotSuspendDriver = await request(server)
        .post(`/api/v1/admin/drivers/${driverId}/suspend`)
        .set('Authorization', `Bearer ${verifyTokens.accessToken}`)
        .send({});
      expect(verifyCannotSuspendDriver.status).toBe(403);
      expect((verifyCannotSuspendDriver.body as ErrorBody).error.code).toBe(
        'AUTH_FORBIDDEN',
      );

      const stillActive = await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantId })
        .first();
      expect(stillActive?.status).toBe('ACTIVE');
      const stillApproved = await prisma
        .getDb()
        .orm.public.DriverProfile.where({ id: driverId })
        .first();
      expect(stillApproved?.verificationStatus).toBe('APPROVED');
    } finally {
      await cleanupMerchantsByIds(merchantIds);
      for (const phone of e164.reverse()) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('Test A: active Driver Delivery + Admin suspend leaves logistics unchanged', async () => {
    const server = app.getHttpServer();
    const suffix = (Date.now() + 10).toString().slice(-6);
    const phones = {
      customer: `0601${suffix}`,
      owner: `0602${suffix}`,
      driver: `0603${suffix}`,
      admin: `0604${suffix}`,
    };
    const e164: string[] = [];
    const zoneIds: string[] = [];
    let socket: Socket | undefined;
    try {
      const customerTokens = await authenticate(
        phones.customer,
        'suspend-a-customer',
      );
      const ownerTokens = await authenticate(phones.owner, 'suspend-a-owner');
      const driverTokens = await authenticate(
        phones.driver,
        'suspend-a-driver',
      );
      const adminTokens = await authenticate(phones.admin, 'suspend-a-admin');
      const customer = await authMe(customerTokens.accessToken);
      const owner = await authMe(ownerTokens.accessToken);
      const driverAccount = await authMe(driverTokens.accessToken);
      const adminAccount = await authMe(adminTokens.accessToken);
      e164.push(
        customer.phone,
        owner.phone,
        driverAccount.phone,
        adminAccount.phone,
      );

      const { adminId } = await seedAdminWithPermissions(
        adminAccount.id,
        `a-${suffix}`,
        [
          ADMIN_PERMISSIONS.DRIVERS_VERIFY,
          ADMIN_PERMISSIONS.DRIVERS_SUSPEND,
          ADMIN_PERMISSIONS.AUDIT_READ,
        ],
      );

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${customerTokens.accessToken}`)
        .send({ fullName: 'Suspend A Customer' });
      const home = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerTokens.accessToken}`)
        .send({
          label: 'Home',
          addressText: 'Dropoff A',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      expect(home.status).toBe(201);
      const homeId = (home.body as AddressBody).id;

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ name: `Suspend A Cafe ${suffix}` });
      expect(merchant.status).toBe(201);
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({
          name: 'Main',
          phone: '0550123401',
          addressText: 'Street A',
          latitude: 36.75,
          longitude: 3.05,
        });
      const branchId = (branch.body as BranchBody).id;
      await ensureBranchOpeningHours(prisma, branchId, owner.id);
      await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantId })
        .update({
          status: pgVarchar<64>('ACTIVE'),
          verifiedAt: pgNow(),
          updatedAt: pgNow(),
        });

      const now = pgNow();
      const category = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ branchId, name: 'Drinks' });
      const product = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({
          branchId,
          categoryId: (category.body as CategoryBody).id,
          name: 'Tea',
          priceMinor: 1000,
        });
      const productId = (product.body as ProductBody).id;
      const group = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups`,
        )
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
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
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ name: 'Large', additionalPriceMinor: 200 });
      const largeId = (large.body as OptionBody).id;

      const zoneId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Suspend A zone ${suffix}`),
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
        driverTokens.accessToken,
        'Suspend A Driver',
        `SA ${suffix}`,
      );
      const approved = await request(server)
        .post(`/api/v1/admin/drivers/${driverId}/verification/approve`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(approved.status).toBe(201);
      const goOnline = await request(server)
        .post('/api/v1/driver/availability/go-online')
        .set('Authorization', `Bearer ${driverTokens.accessToken}`)
        .send({});
      expect(goOnline.status).toBe(200);
      await locations.upsert(
        driverId,
        36.7504,
        3.0504,
        new Date().toISOString(),
      );

      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${customerTokens.accessToken}`)
        .send({ productId, quantity: 1, optionIds: [largeId] });
      const preview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${customerTokens.accessToken}`)
        .send({ addressId: homeId });
      const created = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${customerTokens.accessToken}`)
        .send({
          addressId: homeId,
          paymentMethod: 'COD',
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
      expect(created.status).toBe(201);
      const orderId = (created.body as { id: string }).id;
      await request(server)
        .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/accept`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({});
      await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${orderId}/start-preparation`,
        )
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({});
      await request(server)
        .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/mark-ready`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({});

      const offered = await matching.startForReadyOrder(orderId);
      expect(offered.assignment?.driverId).toBe(driverId);
      const accepted = await request(server)
        .post(`/api/v1/driver/assignments/${offered.assignment!.id}/accept`)
        .set('Authorization', `Bearer ${driverTokens.accessToken}`)
        .send({});
      expect(accepted.status).toBe(200);
      const assignmentId = offered.assignment!.id;

      const deliveryBefore = await prisma
        .getDb()
        .orm.public.Delivery.where({ orderId })
        .first();
      const orderBefore = await prisma
        .getDb()
        .orm.public.Order.where({ id: orderId })
        .first();
      const assignmentBefore = await prisma
        .getDb()
        .orm.public.DriverAssignment.where({ id: assignmentId })
        .first();
      const earningCountBefore = (
        await prisma.getDb().orm.public.DriverEarning.where({ driverId }).all()
      ).length;
      const refundCountBefore = (
        await prisma.getDb().orm.public.Refund.where({ orderId }).all()
      ).length;
      expect(deliveryBefore?.status).toBe('DRIVER_ASSIGNED');
      expect(orderBefore?.status).toBe('ACTIVE');
      expect(assignmentBefore?.status).toBe('ACCEPTED');
      expect(assignmentBefore?.driverId).toBe(driverId);

      await seedWarmActiveSnap(sessionIdFromAccess(driverTokens.accessToken));
      socket = await connectTracking(driverTokens.accessToken);
      expect(socket.connected).toBe(true);
      const disconnectPromise = new Promise<{ code?: string }>((resolve) => {
        socket!.once(TRACKING_EVENT_ERROR, (payload: { code?: string }) => {
          resolve(payload);
        });
        socket!.once('disconnect', () => {
          resolve({});
        });
      });

      const suspended = await request(server)
        .post(`/api/v1/admin/drivers/${driverId}/suspend`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(suspended.status).toBe(201);
      expect(suspended.body).toMatchObject({
        id: driverId,
        verificationStatus: 'SUSPENDED',
      });

      const meDenied = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${driverTokens.accessToken}`);
      expect(meDenied.status).toBe(401);
      expect((meDenied.body as ErrorBody).error.code).toBe(
        'AUTH_SESSION_REVOKED',
      );
      const refreshDenied = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: driverTokens.refreshToken });
      expect(refreshDenied.status).toBe(401);
      expect((refreshDenied.body as ErrorBody).error.code).toBe(
        'AUTH_SESSION_REVOKED',
      );
      const nextAction = await request(server)
        .post('/api/v1/driver/deliveries/current/start-to-pickup')
        .set('Authorization', `Bearer ${driverTokens.accessToken}`)
        .send({});
      expect(nextAction.status).toBe(401);
      expect((nextAction.body as ErrorBody).error.code).toBe(
        'AUTH_SESSION_REVOKED',
      );

      await disconnectPromise;
      expect(socket.connected).toBe(false);

      const deliveryAfter = await prisma
        .getDb()
        .orm.public.Delivery.where({ orderId })
        .first();
      const orderAfter = await prisma
        .getDb()
        .orm.public.Order.where({ id: orderId })
        .first();
      const assignmentAfter = await prisma
        .getDb()
        .orm.public.DriverAssignment.where({ id: assignmentId })
        .first();
      expect(deliveryAfter?.status).toBe(deliveryBefore!.status);
      expect(orderAfter?.status).toBe(orderBefore!.status);
      expect(orderAfter?.fulfillmentStatus).toBe(
        orderBefore!.fulfillmentStatus,
      );
      expect(assignmentAfter).toBeTruthy();
      expect(assignmentAfter?.driverId).toBe(driverId);
      expect(assignmentAfter?.status).toBe('ACCEPTED');
      expect(
        (
          await prisma
            .getDb()
            .orm.public.DriverEarning.where({ driverId })
            .all()
        ).length,
      ).toBe(earningCountBefore);
      expect(
        (await prisma.getDb().orm.public.Refund.where({ orderId }).all())
          .length,
      ).toBe(refundCountBefore);

      const audits = await request(server)
        .get('/api/v1/admin/audit')
        .query({
          adminId,
          action: ADMIN_AUDIT_ACTIONS.DRIVER_SUSPEND,
          targetId: driverId,
        })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);
      expect(audits.status).toBe(200);
      expect(
        (audits.body as { items: Array<{ afterJson: object | null }> }).items[0]
          ?.afterJson,
      ).toMatchObject({
        sessionsRevoked: 1,
        affectedAccountCount: 1,
        verificationStatus: 'SUSPENDED',
      });

      const fresh = await authenticate(phones.driver, 'suspend-a-fresh');
      const goOnlineFresh = await request(server)
        .post('/api/v1/driver/availability/go-online')
        .set('Authorization', `Bearer ${fresh.accessToken}`)
        .send({});
      expect(goOnlineFresh.status).toBe(409);
      expect((goOnlineFresh.body as ErrorBody).error.code).toBe(
        'DRIVER_NOT_APPROVED',
      );
    } finally {
      if (socket) {
        socket.disconnect();
      }
      if (e164[0]) {
        await cleanupByPhone(e164[0]);
      }
      await cleanupZones(zoneIds);
      for (const phone of e164.slice(1).reverse()) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('Test B: active Merchant Order + Admin suspend preserves order/catalog', async () => {
    const server = app.getHttpServer();
    const suffix = (Date.now() + 11).toString().slice(-6);
    const phones = {
      customer: `0611${suffix}`,
      owner: `0612${suffix}`,
      manager: `0613${suffix}`,
      admin: `0614${suffix}`,
    };
    const e164: string[] = [];
    const zoneIds: string[] = [];
    try {
      const customerTokens = await authenticate(
        phones.customer,
        'suspend-b-customer',
      );
      const ownerTokens = await authenticate(phones.owner, 'suspend-b-owner');
      const managerTokens = await authenticate(
        phones.manager,
        'suspend-b-manager',
      );
      const adminTokens = await authenticate(phones.admin, 'suspend-b-admin');
      const customer = await authMe(customerTokens.accessToken);
      const owner = await authMe(ownerTokens.accessToken);
      const manager = await authMe(managerTokens.accessToken);
      const adminAccount = await authMe(adminTokens.accessToken);
      e164.push(customer.phone, owner.phone, manager.phone, adminAccount.phone);

      const { adminId } = await seedAdminWithPermissions(
        adminAccount.id,
        `b-${suffix}`,
        [
          ADMIN_PERMISSIONS.MERCHANTS_VERIFY,
          ADMIN_PERMISSIONS.MERCHANTS_SUSPEND,
          ADMIN_PERMISSIONS.AUDIT_READ,
        ],
      );

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${customerTokens.accessToken}`)
        .send({ fullName: 'Suspend B Customer' });
      const home = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerTokens.accessToken}`)
        .send({
          label: 'Home',
          addressText: 'Dropoff B',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const homeId = (home.body as AddressBody).id;

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ name: `Suspend B Cafe ${suffix}` });
      const merchantId = (merchant.body as MembershipBody).merchantId;
      await seedMembership(merchantId, manager.id, 'MANAGER');
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({
          name: 'Main',
          phone: '0550123402',
          addressText: 'Street B',
          latitude: 36.75,
          longitude: 3.05,
        });
      const branchId = (branch.body as BranchBody).id;
      await ensureBranchOpeningHours(prisma, branchId, owner.id);
      await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantId })
        .update({
          status: pgVarchar<64>('ACTIVE'),
          verifiedAt: pgNow(),
          updatedAt: pgNow(),
        });

      const now = pgNow();
      const category = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ branchId, name: 'Drinks' });
      const product = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({
          branchId,
          categoryId: (category.body as CategoryBody).id,
          name: 'Coffee',
          priceMinor: 1000,
        });
      const productId = (product.body as ProductBody).id;
      const group = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups`,
        )
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
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
        .set('Authorization', `Bearer ${ownerTokens.accessToken}`)
        .send({ name: 'Large', additionalPriceMinor: 200 });
      const largeId = (large.body as OptionBody).id;

      const zoneId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Suspend B zone ${suffix}`),
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

      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${customerTokens.accessToken}`)
        .send({ productId, quantity: 1, optionIds: [largeId] });
      const preview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${customerTokens.accessToken}`)
        .send({ addressId: homeId });
      const created = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${customerTokens.accessToken}`)
        .send({
          addressId: homeId,
          paymentMethod: 'COD',
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
      expect(created.status).toBe(201);
      const orderId = (created.body as { id: string }).id;
      expect(
        (created.body as { fulfillmentStatus: string }).fulfillmentStatus,
      ).toBe('PENDING_ACCEPTANCE');

      const ownerDeviceB = await authenticate(
        phones.owner,
        'suspend-b-owner-b',
      );
      const managerDeviceB = await authenticate(
        phones.manager,
        'suspend-b-manager-b',
      );

      const orderBefore = await prisma
        .getDb()
        .orm.public.Order.where({ id: orderId })
        .first();
      const paymentBefore = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId })
        .first();
      const memberCountBefore = (
        await prisma
          .getDb()
          .orm.public.MerchantMember.where({ merchantId })
          .all()
      ).length;
      const productCountBefore = (
        await prisma
          .getDb()
          .orm.public.Product.where({ merchantBranchId: branchId })
          .all()
      ).length;
      const branchBefore = await prisma
        .getDb()
        .orm.public.MerchantBranch.where({ id: branchId })
        .first();

      // Refill cart while Merchant is still ACTIVE so checkout can evaluate
      // operational denial after suspend (empty cart → CHECKOUT_CART_REQUIRED).
      const refillCart = await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${customerTokens.accessToken}`)
        .send({ productId, quantity: 1, optionIds: [largeId] });
      expect(refillCart.status).toBe(200);

      const suspended = await request(server)
        .post(`/api/v1/admin/merchants/${merchantId}/suspend`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(suspended.status).toBe(201);
      expect(suspended.body).toMatchObject({
        id: merchantId,
        status: 'SUSPENDED',
      });

      for (const token of [
        ownerTokens.accessToken,
        ownerDeviceB.accessToken,
        managerTokens.accessToken,
        managerDeviceB.accessToken,
      ]) {
        const denied = await request(server)
          .get('/api/v1/merchant/me')
          .set('Authorization', `Bearer ${token}`);
        expect(denied.status).toBe(401);
        expect((denied.body as ErrorBody).error.code).toBe(
          'AUTH_SESSION_REVOKED',
        );
      }

      const orderAfter = await prisma
        .getDb()
        .orm.public.Order.where({ id: orderId })
        .first();
      const paymentAfter = await prisma
        .getDb()
        .orm.public.Payment.where({ orderId })
        .first();
      expect(orderAfter?.status).toBe(orderBefore!.status);
      expect(orderAfter?.fulfillmentStatus).toBe(
        orderBefore!.fulfillmentStatus,
      );
      expect(paymentAfter?.status).toBe(paymentBefore!.status);
      expect(
        (
          await prisma
            .getDb()
            .orm.public.MerchantMember.where({ merchantId })
            .all()
        ).length,
      ).toBe(memberCountBefore);
      expect(
        (
          await prisma
            .getDb()
            .orm.public.Product.where({ merchantBranchId: branchId })
            .all()
        ).length,
      ).toBe(productCountBefore);
      const branchAfter = await prisma
        .getDb()
        .orm.public.MerchantBranch.where({ id: branchId })
        .first();
      expect(branchAfter?.id).toBe(branchBefore!.id);
      expect(branchAfter?.operationalStatus).toBe(
        branchBefore!.operationalStatus,
      );

      const audits = await request(server)
        .get('/api/v1/admin/audit')
        .query({
          adminId,
          action: ADMIN_AUDIT_ACTIONS.MERCHANT_SUSPEND,
          targetId: merchantId,
        })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);
      expect(audits.status).toBe(200);
      expect(
        (audits.body as { items: Array<{ afterJson: object | null }> }).items[0]
          ?.afterJson,
      ).toMatchObject({
        sessionsRevoked: 4,
        affectedAccountCount: 2,
        status: 'SUSPENDED',
      });

      const freshOwner = await authenticate(phones.owner, 'suspend-b-fresh');
      const acceptDenied = await request(server)
        .post(`/api/v1/merchant/${merchantId}/orders/${orderId}/accept`)
        .set('Authorization', `Bearer ${freshOwner.accessToken}`)
        .send({});
      expect(acceptDenied.status).toBe(409);
      expect((acceptDenied.body as ErrorBody).error.code).toBe(
        'MERCHANT_STATUS_RESTRICTED',
      );
      const prepDenied = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/orders/${orderId}/start-preparation`,
        )
        .set('Authorization', `Bearer ${freshOwner.accessToken}`)
        .send({});
      expect(prepDenied.status).toBe(409);
      expect((prepDenied.body as ErrorBody).error.code).toBe(
        'MERCHANT_STATUS_RESTRICTED',
      );

      const checkoutDenied = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${customerTokens.accessToken}`)
        .send({ addressId: homeId });
      expect(checkoutDenied.status).toBe(409);
      expect((checkoutDenied.body as ErrorBody).error.code).toBe(
        'CHECKOUT_MERCHANT_NOT_OPERATIONAL',
      );
    } finally {
      if (e164[0]) {
        await cleanupByPhone(e164[0]);
      }
      await cleanupZones(zoneIds);
      for (const phone of e164.slice(1).reverse()) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('Test C: multi-Merchant Account — suspend A leaves B accessible', async () => {
    const server = app.getHttpServer();
    const suffix = (Date.now() + 12).toString().slice(-6);
    const phones = {
      owner: `0621${suffix}`,
      admin: `0622${suffix}`,
    };
    const e164: string[] = [];
    const merchantIds: string[] = [];
    try {
      const ownerTokens = await authenticate(phones.owner, 'suspend-c-owner');
      const owner = await authMe(ownerTokens.accessToken);
      e164.push(owner.phone);

      const adminTokens = await authenticate(phones.admin, 'suspend-c-admin');
      const adminAccount = await authMe(adminTokens.accessToken);
      e164.push(adminAccount.phone);
      await seedAdminWithPermissions(adminAccount.id, `c-${suffix}`, [
        ADMIN_PERMISSIONS.MERCHANTS_VERIFY,
        ADMIN_PERMISSIONS.MERCHANTS_SUSPEND,
        ADMIN_PERMISSIONS.AUDIT_READ,
      ]);

      const merchantA = await submitMerchantForReview(
        ownerTokens.accessToken,
        `Suspend C A ${suffix}`,
      );
      merchantIds.push(merchantA);
      const merchantB = await submitMerchantForReview(
        ownerTokens.accessToken,
        `Suspend C B ${suffix}`,
      );
      merchantIds.push(merchantB);

      for (const merchantId of [merchantA, merchantB]) {
        const approved = await request(server)
          .post(`/api/v1/admin/merchants/${merchantId}/verification/approve`)
          .set('Authorization', `Bearer ${adminTokens.accessToken}`)
          .send({});
        expect(approved.status).toBe(201);
      }

      const ownerDeviceB = await authenticate(
        phones.owner,
        'suspend-c-owner-b',
      );

      const suspended = await request(server)
        .post(`/api/v1/admin/merchants/${merchantA}/suspend`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(suspended.status).toBe(201);

      for (const token of [ownerTokens.accessToken, ownerDeviceB.accessToken]) {
        const denied = await request(server)
          .get('/api/v1/merchant/me')
          .set('Authorization', `Bearer ${token}`);
        expect(denied.status).toBe(401);
        expect((denied.body as ErrorBody).error.code).toBe(
          'AUTH_SESSION_REVOKED',
        );
      }

      const merchantBRow = await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantB })
        .first();
      expect(merchantBRow?.status).toBe('ACTIVE');

      const fresh = await authenticate(phones.owner, 'suspend-c-fresh');
      const me = await request(server)
        .get('/api/v1/merchant/me')
        .set('Authorization', `Bearer ${fresh.accessToken}`);
      expect(me.status).toBe(200);
      const memberships = (
        me.body as {
          memberships: Array<{
            merchantId: string;
            merchant: { status: string };
          }>;
        }
      ).memberships;
      expect(
        memberships.find((row) => row.merchantId === merchantA)?.merchant
          .status,
      ).toBe('SUSPENDED');
      expect(
        memberships.find((row) => row.merchantId === merchantB)?.merchant
          .status,
      ).toBe('ACTIVE');

      const mutateA = await request(server)
        .patch(`/api/v1/merchant/${merchantA}/profile`)
        .set('Authorization', `Bearer ${fresh.accessToken}`)
        .send({ name: 'Should Fail A' });
      expect(mutateA.status).toBe(409);
      expect((mutateA.body as ErrorBody).error.code).toBe(
        'MERCHANT_STATUS_RESTRICTED',
      );

      const branchB = await request(server)
        .post(`/api/v1/merchant/${merchantB}/branches`)
        .set('Authorization', `Bearer ${fresh.accessToken}`)
        .send({
          name: 'B Main',
          phone: '0550123403',
          addressText: 'Street C',
          latitude: 36.75,
          longitude: 3.05,
        });
      expect(branchB.status).toBe(201);
    } finally {
      await cleanupMerchantsByIds(merchantIds);
      for (const phone of e164.reverse()) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('Test D: shared CustomerProfile survives domain suspend', async () => {
    const server = app.getHttpServer();
    const suffix = (Date.now() + 13).toString().slice(-6);
    const phones = {
      driver: `0631${suffix}`,
      admin: `0632${suffix}`,
    };
    const e164: string[] = [];
    try {
      const driverTokens = await authenticate(
        phones.driver,
        'suspend-d-driver',
      );
      const driverAccount = await authMe(driverTokens.accessToken);
      e164.push(driverAccount.phone);

      const adminTokens = await authenticate(phones.admin, 'suspend-d-admin');
      const adminAccount = await authMe(adminTokens.accessToken);
      e164.push(adminAccount.phone);
      await seedAdminWithPermissions(adminAccount.id, `d-${suffix}`, [
        ADMIN_PERMISSIONS.DRIVERS_VERIFY,
        ADMIN_PERMISSIONS.DRIVERS_SUSPEND,
        ADMIN_PERMISSIONS.AUDIT_READ,
      ]);

      const customerProfile = await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${driverTokens.accessToken}`)
        .send({ fullName: 'Driver Also Customer' });
      expect(customerProfile.status).toBe(201);

      const driverId = await onboardApprovedDriver(
        driverTokens.accessToken,
        'Suspend D Driver',
        `SD ${suffix}`,
      );
      const approved = await request(server)
        .post(`/api/v1/admin/drivers/${driverId}/verification/approve`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(approved.status).toBe(201);

      const suspended = await request(server)
        .post(`/api/v1/admin/drivers/${driverId}/suspend`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(suspended.status).toBe(201);

      const revoked = await request(server)
        .get('/api/v1/customer/me')
        .set('Authorization', `Bearer ${driverTokens.accessToken}`);
      expect(revoked.status).toBe(401);
      expect((revoked.body as ErrorBody).error.code).toBe(
        'AUTH_SESSION_REVOKED',
      );

      const fresh = await authenticate(phones.driver, 'suspend-d-fresh');
      const customerMe = await request(server)
        .get('/api/v1/customer/me')
        .set('Authorization', `Bearer ${fresh.accessToken}`);
      expect(customerMe.status).toBe(200);
      expect(
        (customerMe.body as { customerProfileExists: boolean })
          .customerProfileExists,
      ).toBe(true);

      const goOnline = await request(server)
        .post('/api/v1/driver/availability/go-online')
        .set('Authorization', `Bearer ${fresh.accessToken}`)
        .send({});
      expect(goOnline.status).toBe(409);
      expect((goOnline.body as ErrorBody).error.code).toBe(
        'DRIVER_NOT_APPROVED',
      );

      const accountRow = await prisma
        .getDb()
        .orm.public.Account.where({ id: driverAccount.id })
        .first();
      expect(accountRow?.status).toBe('ACTIVE');
      const customerStill = await prisma
        .getDb()
        .orm.public.CustomerProfile.where({ accountId: driverAccount.id })
        .first();
      expect(customerStill).toBeTruthy();
    } finally {
      for (const phone of e164.reverse()) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('Test E: idempotent re-suspension revokes fresh session and audits alreadySuspended', async () => {
    const server = app.getHttpServer();
    const suffix = (Date.now() + 14).toString().slice(-6);
    const phones = {
      driver: `0641${suffix}`,
      admin: `0642${suffix}`,
    };
    const e164: string[] = [];
    try {
      const driverTokens = await authenticate(
        phones.driver,
        'suspend-e-driver',
      );
      const driverAccount = await authMe(driverTokens.accessToken);
      e164.push(driverAccount.phone);

      const adminTokens = await authenticate(phones.admin, 'suspend-e-admin');
      const adminAccount = await authMe(adminTokens.accessToken);
      e164.push(adminAccount.phone);
      const { adminId } = await seedAdminWithPermissions(
        adminAccount.id,
        `e-${suffix}`,
        [
          ADMIN_PERMISSIONS.DRIVERS_VERIFY,
          ADMIN_PERMISSIONS.DRIVERS_SUSPEND,
          ADMIN_PERMISSIONS.AUDIT_READ,
        ],
      );

      const driverId = await onboardApprovedDriver(
        driverTokens.accessToken,
        'Suspend E Driver',
        `SE ${suffix}`,
      );
      const approved = await request(server)
        .post(`/api/v1/admin/drivers/${driverId}/verification/approve`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(approved.status).toBe(201);

      const first = await request(server)
        .post(`/api/v1/admin/drivers/${driverId}/suspend`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(first.status).toBe(201);

      const fresh = await authenticate(phones.driver, 'suspend-e-fresh');
      const freshSid = sessionIdFromAccess(fresh.accessToken);
      const freshMe = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${fresh.accessToken}`);
      expect(freshMe.status).toBe(200);

      const second = await request(server)
        .post(`/api/v1/admin/drivers/${driverId}/suspend`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(second.status).toBe(201);
      expect(second.body).toMatchObject({
        id: driverId,
        verificationStatus: 'SUSPENDED',
      });
      expect(second.body).not.toHaveProperty('alreadySuspended');

      const revoked = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${fresh.accessToken}`);
      expect(revoked.status).toBe(401);
      expect((revoked.body as ErrorBody).error.code).toBe(
        'AUTH_SESSION_REVOKED',
      );
      const sessionRow = await prisma
        .getDb()
        .orm.public.Session.where({ id: freshSid })
        .first();
      expect(sessionRow?.revokedAt).toBeTruthy();

      const audits = await request(server)
        .get('/api/v1/admin/audit')
        .query({
          adminId,
          action: ADMIN_AUDIT_ACTIONS.DRIVER_SUSPEND,
          targetId: driverId,
        })
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);
      expect(audits.status).toBe(200);
      const items = (
        audits.body as {
          items: Array<{ afterJson: { alreadySuspended?: boolean } | null }>;
        }
      ).items;
      expect(items.length).toBeGreaterThanOrEqual(2);
      const idempotent = items.find(
        (row) => row.afterJson?.alreadySuspended === true,
      );
      expect(idempotent?.afterJson).toMatchObject({
        alreadySuspended: true,
        sessionsRevoked: 1,
        verificationStatus: 'SUSPENDED',
      });
    } finally {
      for (const phone of e164.reverse()) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('Test F: concurrent suspend + refresh ends suspended with no surviving access', async () => {
    const server = app.getHttpServer();
    const suffix = (Date.now() + 15).toString().slice(-6);
    const phones = {
      driver: `0651${suffix}`,
      admin: `0652${suffix}`,
    };
    const e164: string[] = [];
    try {
      const driverTokens = await authenticate(
        phones.driver,
        'suspend-f-driver',
      );
      const driverAccount = await authMe(driverTokens.accessToken);
      e164.push(driverAccount.phone);

      const adminTokens = await authenticate(phones.admin, 'suspend-f-admin');
      const adminAccount = await authMe(adminTokens.accessToken);
      e164.push(adminAccount.phone);
      await seedAdminWithPermissions(adminAccount.id, `f-${suffix}`, [
        ADMIN_PERMISSIONS.DRIVERS_VERIFY,
        ADMIN_PERMISSIONS.DRIVERS_SUSPEND,
        ADMIN_PERMISSIONS.AUDIT_READ,
      ]);

      const driverId = await onboardApprovedDriver(
        driverTokens.accessToken,
        'Suspend F Driver',
        `SF ${suffix}`,
      );
      const approved = await request(server)
        .post(`/api/v1/admin/drivers/${driverId}/verification/approve`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      expect(approved.status).toBe(201);

      const sid = sessionIdFromAccess(driverTokens.accessToken);
      const refreshPromise = request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: driverTokens.refreshToken });
      const suspendA = request(server)
        .post(`/api/v1/admin/drivers/${driverId}/suspend`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});
      const suspendB = request(server)
        .post(`/api/v1/admin/drivers/${driverId}/suspend`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({});

      const [refreshRes, aRes, bRes] = await Promise.all([
        refreshPromise,
        suspendA,
        suspendB,
      ]);

      expect([aRes.status, bRes.status].every((s) => s === 201)).toBe(true);
      expect(aRes.body).toMatchObject({
        id: driverId,
        verificationStatus: 'SUSPENDED',
      });
      expect(bRes.body).toMatchObject({
        id: driverId,
        verificationStatus: 'SUSPENDED',
      });

      const profile = await prisma
        .getDb()
        .orm.public.DriverProfile.where({ id: driverId })
        .first();
      expect(profile?.verificationStatus).toBe('SUSPENDED');

      const sessions = await prisma
        .getDb()
        .orm.public.Session.where({ accountId: driverAccount.id })
        .all();
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((row) => row.revokedAt != null)).toBe(true);
      expect(sessions.every((row) => row.id && row.accountId)).toBe(true);

      const accessAfter = await request(server)
        .get('/api/v1/driver/me')
        .set('Authorization', `Bearer ${driverTokens.accessToken}`);
      expect(accessAfter.status).toBe(401);
      expect((accessAfter.body as ErrorBody).error.code).toBe(
        'AUTH_SESSION_REVOKED',
      );

      // Refresh rotates the same Session row; after suspend commit that row is revoked,
      // so either refresh lost the race (401) or its rotated tokens also fail assertPrincipal.
      if (refreshRes.status === 200) {
        const rotated = refreshRes.body as TokenPair;
        const rotatedAccess = await request(server)
          .get('/api/v1/driver/me')
          .set('Authorization', `Bearer ${rotated.accessToken}`);
        expect(rotatedAccess.status).toBe(401);
        expect((rotatedAccess.body as ErrorBody).error.code).toBe(
          'AUTH_SESSION_REVOKED',
        );
        const rotatedRefresh = await request(server)
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: rotated.refreshToken });
        expect(rotatedRefresh.status).toBe(401);
      } else {
        expect(refreshRes.status).toBe(401);
      }

      const originalRefresh = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: driverTokens.refreshToken });
      expect(originalRefresh.status).toBe(401);

      const sessionRow = await prisma
        .getDb()
        .orm.public.Session.where({ id: sid })
        .first();
      expect(sessionRow?.revokedAt).toBeTruthy();
    } finally {
      for (const phone of e164.reverse()) {
        await cleanupByPhone(phone);
      }
    }
  });
});
