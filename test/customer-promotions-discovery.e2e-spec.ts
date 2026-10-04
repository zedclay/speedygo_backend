/**
 * Isolated e2e: Customer promotion discovery + Admin publish/hide.
 * Does not overlap other e2e jobs. Never redeems on GET.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createUuidV7 } from '../src/common/utils/uuid-v7';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { PrismaService } from '../src/infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { ADMIN_AUDIT_ACTIONS } from '../src/modules/admin/domain/admin-audit-actions';
import { ADMIN_PERMISSIONS } from '../src/modules/admin/domain/admin-permissions';
import { PermissionService } from '../src/modules/authorization/permission.service';
import {
  PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
  PROMOTION_TYPE_SPEEDYGO_RATE_BPS,
} from '../src/modules/promotions/domain/promotion.types';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';

type TokenBody = { accessToken: string };
type AuthMeBody = { account: { id: string; phone: string } };
type PromoBody = {
  id: string;
  code: string;
  type: string;
  value: number | string;
  active: boolean;
  customerDiscoverable: boolean;
  customerLabel: string | null;
};
type DiscoveryItem = {
  id: string;
  code: string;
  discountKind: string;
  value: number;
  startsAt: string;
  endsAt: string;
  customerLabel: string | null;
  eligibility: string;
  type?: unknown;
  funding?: unknown;
  customerDiscoverable?: unknown;
};
type DiscoveryBody = { items: DiscoveryItem[] };

describe('Customer promotion discovery (e2e)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
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
    redis = app.get(RedisService);
    permissions = app.get(PermissionService);
    const leftover = await redis.getClient().keys('auth:test:*');
    if (leftover.length > 0) {
      await redis.getClient().del(...leftover);
    }
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
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
        deviceName: 'promo-discovery-e2e',
      });
    expect(verified.status).toBe(200);
    return (verified.body as TokenBody).accessToken;
  }

  async function authMe(token: string): Promise<AuthMeBody['account']> {
    const r = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    return (r.body as AuthMeBody).account;
  }

  async function seedAdmin(
    accountId: string,
    suffix: string,
  ): Promise<{ adminId: string; roleId: string }> {
    const now = pgNow();
    const roleId = createUuidV7();
    await prisma.getDb().orm.public.Role.create({
      id: roleId,
      name: pgVarchar<128>(`promo-disc-${suffix}`),
      description: null,
      active: true,
    });
    for (const code of [
      ADMIN_PERMISSIONS.PROMOTIONS_MANAGE,
      ADMIN_PERMISSIONS.PROMOTIONS_READ,
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
      displayName: pgVarchar<255>(`Promo Disc ${suffix}`),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await permissions.invalidate(accountId);
    return { adminId, roleId };
  }

  async function cleanupByPhone(phone: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    const account = await db.Account.where({ phone }).first();
    if (!account) {
      return;
    }
    const admin = await db.AdminProfile.where({
      accountId: account.id,
    }).first();
    if (admin) {
      const links = await db.RolePermission.where({
        roleId: admin.roleId,
      }).all();
      for (const link of links) {
        await db.RolePermission.where({
          roleId: link.roleId,
          permissionId: link.permissionId,
        }).delete();
      }
      const auditLogs = await db.AuditLog.where({ adminId: admin.id }).all();
      for (const log of auditLogs) {
        await db.AuditLog.where({ id: log.id }).delete();
      }
      await db.AdminProfile.where({ id: admin.id }).delete();
      await db.Role.where({ id: admin.roleId }).delete();
    }
    const customer = await db.CustomerProfile.where({
      accountId: account.id,
    }).first();
    if (customer) {
      await db.CustomerProfile.where({ id: customer.id }).delete();
    }
    await deleteAccountNotificationArtifacts(prisma, account.id);
    const sessions = await db.Session.where({ accountId: account.id }).all();
    for (const session of sessions) {
      await db.Session.where({ id: session.id }).delete();
    }
    const devices = await db.Device.where({ accountId: account.id }).all();
    for (const device of devices) {
      await db.Device.where({ id: device.id }).delete();
    }
    await db.Account.where({ id: account.id }).delete();
  }

  async function deletePromos(ids: string[]): Promise<void> {
    const db = prisma.getDb().orm.public;
    for (const id of ids) {
      for (const red of await db.PromotionRedemption.where({
        promotionId: id,
      }).all()) {
        await db.PromotionRedemption.where({ id: red.id }).delete();
      }
      await db.Promotion.where({ id }).delete();
    }
  }

  async function redemptionCount(): Promise<number> {
    const counted = await prisma
      .getDb()
      .orm.public.PromotionRedemption.aggregate((agg) => ({
        total: agg.count(),
      }));
    return Number(counted.total);
  }

  it('requires auth and a CustomerProfile; unpublished offers stay hidden', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-6)}`;
    const adminPhone = `0581${suffix}`;
    const customerPhone = `0582${suffix}`;
    const promoIds: string[] = [];
    const phones = [adminPhone, customerPhone];
    try {
      const unauth = await request(server).get('/api/v1/customer/promotions');
      expect(unauth.status).toBe(401);

      const customerToken = await authenticate(customerPhone);
      const noProfile = await request(server)
        .get('/api/v1/customer/promotions')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(noProfile.status).toBe(404);
      expect((noProfile.body as { error?: { code?: string } }).error?.code).toBe(
        'CUSTOMER_PROFILE_NOT_FOUND',
      );

      const profile = await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ fullName: 'Discovery Customer' });
      expect(profile.status).toBe(201);

      const adminToken = await authenticate(adminPhone);
      const adminAccount = await authMe(adminToken);
      const { adminId } = await seedAdmin(adminAccount.id, suffix);

      const created = await request(server)
        .post('/api/v1/admin/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `hid_${suffix}`,
          type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
          value: 15000,
          startsAt: '2020-01-01T00:00:00.000Z',
          endsAt: '2099-01-01T00:00:00.000Z',
        });
      expect(created.status).toBe(201);
      const hidden = created.body as PromoBody;
      promoIds.push(hidden.id);
      expect(hidden.customerDiscoverable).toBe(false);
      expect(hidden.code).toBe(`HID_${suffix}`);

      const before = await redemptionCount();
      const empty = await request(server)
        .get('/api/v1/customer/promotions')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(empty.status).toBe(200);
      expect((empty.body as DiscoveryBody).items).toEqual([]);
      expect(await redemptionCount()).toBe(before);

      const published = await request(server)
        .post(`/api/v1/admin/promotions/${hidden.id}/publish-discovery`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ customerLabel: 'Offre Spéciale' });
      expect(published.status).toBe(201);
      expect((published.body as PromoBody).customerDiscoverable).toBe(true);
      expect((published.body as PromoBody).customerLabel).toBe('Offre Spéciale');

      const listed = await request(server)
        .get('/api/v1/customer/promotions')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(listed.status).toBe(200);
      const items = (listed.body as DiscoveryBody).items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: hidden.id,
        code: `HID_${suffix}`,
        discountKind: 'FIXED_MINOR',
        value: 15000,
        customerLabel: 'Offre Spéciale',
        eligibility: 'DISCOVERABLE',
      });
      expect(items[0]).not.toHaveProperty('type');
      expect(items[0]).not.toHaveProperty('funding');
      expect(items[0]).not.toHaveProperty('customerDiscoverable');
      expect(items[0]).not.toHaveProperty('active');
      expect(await redemptionCount()).toBe(before);

      const audits = await request(server)
        .get('/api/v1/admin/audit')
        .query({
          adminId,
          action: ADMIN_AUDIT_ACTIONS.PROMOTION_PUBLISH_DISCOVERY,
          targetId: hidden.id,
        })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(audits.status).toBe(200);
      expect((audits.body as { total: number }).total).toBeGreaterThanOrEqual(1);

      const hiddenAgain = await request(server)
        .post(`/api/v1/admin/promotions/${hidden.id}/hide-discovery`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(hiddenAgain.status).toBe(201);
      const afterHide = await request(server)
        .get('/api/v1/customer/promotions')
        .set('Authorization', `Bearer ${customerToken}`);
      expect((afterHide.body as DiscoveryBody).items).toEqual([]);
    } finally {
      await deletePromos(promoIds);
      for (const phone of phones) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('excludes inactive, future and expired; orders by endsAt then id; transports rate BPS', async () => {
    const server = app.getHttpServer();
    const suffix = `${(Date.now() + 1).toString().slice(-6)}`;
    const adminPhone = `0583${suffix}`;
    const customerPhone = `0584${suffix}`;
    const promoIds: string[] = [];
    try {
      const customerToken = await authenticate(customerPhone);
      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ fullName: 'Window Customer' });
      const adminToken = await authenticate(adminPhone);
      const adminAccount = await authMe(adminToken);
      await seedAdmin(adminAccount.id, suffix);

      const windows = [
        {
          code: `exp_${suffix}`,
          type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
          value: 1000,
          startsAt: '2020-01-01T00:00:00.000Z',
          endsAt: '2020-02-01T00:00:00.000Z',
        },
        {
          code: `fut_${suffix}`,
          type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
          value: 2000,
          startsAt: '2090-01-01T00:00:00.000Z',
          endsAt: '2099-01-01T00:00:00.000Z',
        },
        {
          code: `off_${suffix}`,
          type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
          value: 3000,
          startsAt: '2020-01-01T00:00:00.000Z',
          endsAt: '2099-01-01T00:00:00.000Z',
          active: false,
        },
        {
          code: `late_${suffix}`,
          type: PROMOTION_TYPE_SPEEDYGO_RATE_BPS,
          value: 1000,
          startsAt: '2020-01-01T00:00:00.000Z',
          endsAt: '2098-06-01T00:00:00.000Z',
        },
        {
          code: `soon_${suffix}`,
          type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
          value: 15000,
          startsAt: '2020-01-01T00:00:00.000Z',
          endsAt: '2098-01-01T00:00:00.000Z',
        },
      ];

      for (const body of windows) {
        const created = await request(server)
          .post('/api/v1/admin/promotions')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            ...body,
            customerDiscoverable: true,
          });
        expect(created.status).toBe(201);
        promoIds.push((created.body as PromoBody).id);
      }

      const listed = await request(server)
        .get('/api/v1/customer/promotions')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(listed.status).toBe(200);
      const items = (listed.body as DiscoveryBody).items;
      expect(items.map((item) => item.code)).toEqual([
        `SOON_${suffix}`,
        `LATE_${suffix}`,
      ]);
      expect(items[0]?.discountKind).toBe('FIXED_MINOR');
      expect(items[0]?.value).toBe(15000);
      expect(items[1]?.discountKind).toBe('RATE_BPS');
      expect(items[1]?.value).toBe(1000);
    } finally {
      await deletePromos(promoIds);
      for (const phone of [adminPhone, customerPhone]) {
        await cleanupByPhone(phone);
      }
    }
  });
});
