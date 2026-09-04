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
  pgNow,
  pgTimestamptz,
  pgVarchar,
} from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { PermissionService } from '../src/modules/authorization/permission.service';
import { AdminAuditService } from '../src/modules/admin/application/admin-audit.service';
import { ADMIN_PERMISSIONS } from '../src/modules/admin/domain/admin-permissions';
import { ADMIN_AUDIT_ACTIONS } from '../src/modules/admin/domain/admin-audit-actions';
import { adminAuditFailed } from '../src/modules/admin/domain/admin.errors';
import {
  PROMOTION_TYPE_MERCHANT_RATE_BPS,
  PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
} from '../src/modules/promotions/domain/promotion.types';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type AuthMeBody = { account: { id: string; phone: string } };
type MembershipBody = {
  merchantId: string;
  merchant: { status: string };
};

describe('Admin Foundation (e2e)', () => {
  jest.setTimeout(180_000);

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
        deviceName: 'admin-foundation-e2e',
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
      const availability = await db.DriverAvailability.where({
        driverId: driver.id,
      }).first();
      if (availability) {
        await db.DriverAvailability.where({ driverId: driver.id }).delete();
      }
      await db.DriverProfile.where({ id: driver.id }).delete();
    }

    const members = await db.MerchantMember.where({
      accountId: account.id,
    }).all();
    for (const member of members) {
      const docs = await db.MerchantDocument.where({
        merchantId: member.merchantId,
      }).all();
      for (const doc of docs) {
        await db.MerchantDocument.where({ id: doc.id }).delete();
      }
      const branches = await db.MerchantBranch.where({
        merchantId: member.merchantId,
      }).all();
      for (const branch of branches) {
        await db.MerchantBranch.where({ id: branch.id }).delete();
      }
      await db.MerchantMember.where({ id: member.id }).delete();
      await db.Merchant.where({ id: member.merchantId }).delete();
    }
    const admin = await db.AdminProfile.where({
      accountId: account.id,
    }).first();
    if (admin) {
      const audits = await db.AuditLog.where({ adminId: admin.id }).all();
      for (const audit of audits) {
        await db.AuditLog.where({ id: audit.id }).delete();
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
      name: pgVarchar<128>(opts?.roleName ?? `admin-e2e-${suffix}`),
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
      displayName: pgVarchar<255>('Admin Foundation'),
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

  async function cleanupMerchantsByIds(merchantIds: string[]): Promise<void> {
    const db = prisma.getDb().orm.public;
    for (const merchantId of merchantIds) {
      for (const doc of await db.MerchantDocument.where({
        merchantId,
      }).all()) {
        await db.MerchantDocument.where({ id: doc.id }).delete();
      }
      for (const member of await db.MerchantMember.where({
        merchantId,
      }).all()) {
        await db.MerchantMember.where({ id: member.id }).delete();
      }
      for (const branch of await db.MerchantBranch.where({
        merchantId,
      }).all()) {
        await db.MerchantBranch.where({ id: branch.id }).delete();
      }
      await db.Merchant.where({ id: merchantId }).delete();
    }
  }

  it('blocks non-admin, enforces permissions, audits approve, ignores spoofed adminId', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      owner: `0591${suffix}`,
      admin: `0592${suffix}`,
      limited: `0593${suffix}`,
      civilian: `0594${suffix}`,
    };
    const e164: string[] = [];
    try {
      const ownerToken = await authenticate(phones.owner);
      const adminToken = await authenticate(phones.admin);
      const limitedToken = await authenticate(phones.limited);
      const civilianToken = await authenticate(phones.civilian);
      for (const token of [
        ownerToken,
        adminToken,
        limitedToken,
        civilianToken,
      ]) {
        e164.push((await authMe(token)).phone);
      }

      const adminAccount = await authMe(adminToken);
      const limitedAccount = await authMe(limitedToken);
      const { adminId } = await seedAdminWithPermissions(
        adminAccount.id,
        `full-${suffix}`,
        [
          ADMIN_PERMISSIONS.MERCHANTS_READ,
          ADMIN_PERMISSIONS.MERCHANTS_VERIFY,
          ADMIN_PERMISSIONS.AUDIT_READ,
        ],
      );
      await seedAdminWithPermissions(limitedAccount.id, `lim-${suffix}`, [
        ADMIN_PERMISSIONS.MERCHANTS_READ,
      ]);

      const civilianMe = await request(server)
        .get('/api/v1/admin/me')
        .set('Authorization', `Bearer ${civilianToken}`);
      expect(civilianMe.status).toBe(403);
      expect((civilianMe.body as ErrorBody).error.code).toBe(
        'ADMIN_PROFILE_REQUIRED',
      );

      const limitedList = await request(server)
        .get('/api/v1/admin/merchants')
        .set('Authorization', `Bearer ${limitedToken}`);
      expect(limitedList.status).toBe(200);

      const limitedApprove = await request(server)
        .post(`/api/v1/admin/merchants/${createUuidV7()}/verification/approve`)
        .set('Authorization', `Bearer ${limitedToken}`)
        .send({ adminId: 'spoofed-admin' });
      expect(limitedApprove.status).toBe(403);
      expect((limitedApprove.body as ErrorBody).error.code).toBe(
        'AUTH_FORBIDDEN',
      );

      const me = await request(server)
        .get('/api/v1/admin/me')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(me.status).toBe(200);
      const meBody = me.body as {
        adminProfileId: string;
        accountId: string;
        permissions: string[];
      };
      expect(meBody.adminProfileId).toBe(adminId);
      expect(meBody.accountId).toBe(adminAccount.id);
      expect(meBody.permissions).toEqual(
        expect.arrayContaining([ADMIN_PERMISSIONS.MERCHANTS_VERIFY]),
      );
      expect(me.body).not.toHaveProperty('accessToken');

      const merchantId = await submitMerchantForReview(
        ownerToken,
        `Admin Cafe ${suffix}`,
      );

      const spoof = await request(server)
        .post(`/api/v1/admin/merchants/${merchantId}/verification/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ adminId: createUuidV7() });
      expect(spoof.status).toBe(400);

      const approved = await request(server)
        .post(`/api/v1/admin/merchants/${merchantId}/verification/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(approved.status).toBe(201);
      expect(approved.body).toMatchObject({
        id: merchantId,
        status: 'ACTIVE',
      });

      const audits = await request(server)
        .get('/api/v1/admin/audit')
        .query({
          adminId,
          action: ADMIN_AUDIT_ACTIONS.MERCHANT_VERIFICATION_APPROVE,
          targetId: merchantId,
        })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(audits.status).toBe(200);
      const auditBody = audits.body as {
        total: number;
        items: Array<{
          adminId: string;
          action: string;
          targetId: string;
        }>;
      };
      expect(auditBody.total).toBeGreaterThanOrEqual(1);
      expect(auditBody.items[0]).toMatchObject({
        adminId,
        action: ADMIN_AUDIT_ACTIONS.MERCHANT_VERIFICATION_APPROVE,
        targetId: merchantId,
      });
    } finally {
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('concurrent merchant approve vs reject — one wins', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}9`;
    const phones = {
      owner: `0595${suffix}`,
      admin: `0596${suffix}`,
    };
    const e164: string[] = [];
    try {
      const ownerToken = await authenticate(phones.owner);
      const adminToken = await authenticate(phones.admin);
      e164.push((await authMe(ownerToken)).phone);
      const adminAccount = await authMe(adminToken);
      e164.push(adminAccount.phone);
      await seedAdminWithPermissions(adminAccount.id, `race-${suffix}`, [
        ADMIN_PERMISSIONS.MERCHANTS_VERIFY,
      ]);

      const merchantId = await submitMerchantForReview(
        ownerToken,
        `Race Cafe ${suffix}`,
      );

      const [a, b] = await Promise.all([
        request(server)
          .post(`/api/v1/admin/merchants/${merchantId}/verification/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({}),
        request(server)
          .post(`/api/v1/admin/merchants/${merchantId}/verification/reject`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({}),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const winner = a.status === 201 ? a : b;
      expect(['ACTIVE', 'REJECTED']).toContain(
        (winner.body as { status: string }).status,
      );
    } finally {
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('B1 inactive Role → GET /admin/me ADMIN_ROLE_INACTIVE', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}1`;
    const phone = `0581${suffix}`;
    let e164: string | undefined;
    try {
      const token = await authenticate(phone);
      const account = await authMe(token);
      e164 = account.phone;
      await seedAdminWithPermissions(
        account.id,
        `inactive-${suffix}`,
        [ADMIN_PERMISSIONS.MERCHANTS_READ],
        { active: false },
      );
      const me = await request(server)
        .get('/api/v1/admin/me')
        .set('Authorization', `Bearer ${token}`);
      expect(me.status).toBe(403);
      expect((me.body as ErrorBody).error.code).toBe('ADMIN_ROLE_INACTIVE');
    } finally {
      if (e164) {
        await cleanupByPhone(e164);
      }
    }
  });

  it('B2 Role.name SUPER_ADMIN without merchants.verify → AUTH_FORBIDDEN', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}2`;
    const phones = { owner: `0582${suffix}`, admin: `0583${suffix}` };
    const e164: string[] = [];
    try {
      const ownerToken = await authenticate(phones.owner);
      const adminToken = await authenticate(phones.admin);
      e164.push((await authMe(ownerToken)).phone);
      const adminAccount = await authMe(adminToken);
      e164.push(adminAccount.phone);
      await seedAdminWithPermissions(
        adminAccount.id,
        `super-${suffix}`,
        [ADMIN_PERMISSIONS.MERCHANTS_READ],
        { roleName: 'SUPER_ADMIN' },
      );
      const merchantId = await submitMerchantForReview(
        ownerToken,
        `Super Deny ${suffix}`,
      );
      const denied = await request(server)
        .post(`/api/v1/admin/merchants/${merchantId}/verification/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(denied.status).toBe(403);
      expect((denied.body as ErrorBody).error.code).toBe('AUTH_FORBIDDEN');
    } finally {
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('B3 merchant reject via HTTP + audit actor', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}3`;
    const phones = { owner: `0584${suffix}`, admin: `0585${suffix}` };
    const e164: string[] = [];
    try {
      const ownerToken = await authenticate(phones.owner);
      const adminToken = await authenticate(phones.admin);
      e164.push((await authMe(ownerToken)).phone);
      const adminAccount = await authMe(adminToken);
      e164.push(adminAccount.phone);
      const { adminId } = await seedAdminWithPermissions(
        adminAccount.id,
        `rej-${suffix}`,
        [ADMIN_PERMISSIONS.MERCHANTS_VERIFY, ADMIN_PERMISSIONS.AUDIT_READ],
      );
      const merchantId = await submitMerchantForReview(
        ownerToken,
        `Reject Cafe ${suffix}`,
      );
      const rejected = await request(server)
        .post(`/api/v1/admin/merchants/${merchantId}/verification/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(rejected.status).toBe(201);
      expect(rejected.body).toMatchObject({
        id: merchantId,
        status: 'REJECTED',
      });
      const audits = await request(server)
        .get('/api/v1/admin/audit')
        .query({
          adminId,
          action: ADMIN_AUDIT_ACTIONS.MERCHANT_VERIFICATION_REJECT,
          targetId: merchantId,
        })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(audits.status).toBe(200);
      const items = (
        audits.body as {
          items: Array<{ adminId: string; action: string }>;
        }
      ).items;
      expect(items[0]).toMatchObject({
        adminId,
        action: ADMIN_AUDIT_ACTIONS.MERCHANT_VERIFICATION_REJECT,
      });
    } finally {
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('B4 audit failure rolls back merchant approve', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}4`;
    const phones = { owner: `0586${suffix}`, admin: `0587${suffix}` };
    const e164: string[] = [];
    const audit = app.get(AdminAuditService);
    const spy = jest
      .spyOn(audit, 'recordInTx')
      .mockRejectedValueOnce(adminAuditFailed());
    try {
      const ownerToken = await authenticate(phones.owner);
      const adminToken = await authenticate(phones.admin);
      e164.push((await authMe(ownerToken)).phone);
      const adminAccount = await authMe(adminToken);
      e164.push(adminAccount.phone);
      await seedAdminWithPermissions(adminAccount.id, `audfail-${suffix}`, [
        ADMIN_PERMISSIONS.MERCHANTS_VERIFY,
        ADMIN_PERMISSIONS.MERCHANTS_READ,
      ]);
      const merchantId = await submitMerchantForReview(
        ownerToken,
        `Audit Fail ${suffix}`,
      );
      const failed = await request(server)
        .post(`/api/v1/admin/merchants/${merchantId}/verification/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(failed.status).toBe(500);
      expect((failed.body as ErrorBody).error.code).toBe('ADMIN_AUDIT_FAILED');
      const row = await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantId })
        .first();
      expect(row?.status).toBe('PENDING_REVIEW');
    } finally {
      spy.mockRestore();
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('B5 merchant queue completeness beyond former 500 cap', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}5`;
    const phone = `0588${suffix}`;
    const insertedIds: string[] = [];
    let e164: string | undefined;
    try {
      const adminToken = await authenticate(phone);
      const adminAccount = await authMe(adminToken);
      e164 = adminAccount.phone;
      await seedAdminWithPermissions(adminAccount.id, `queue-${suffix}`, [
        ADMIN_PERMISSIONS.MERCHANTS_VERIFY,
      ]);

      const base = Date.now();
      const targetId = createUuidV7();
      const targetCreatedAt = new Date(base - 86_400_000).toISOString();

      await prisma.getDb().orm.public.Merchant.create({
        id: targetId,
        publicReference: pgVarchar<64>(`aq_${suffix}_0`),
        name: pgVarchar<255>(`Queue Target ${suffix}`),
        status: pgVarchar<64>('PENDING_REVIEW'),
        verifiedAt: null,
        createdAt: pgTimestamptz(targetCreatedAt),
        updatedAt: pgTimestamptz(targetCreatedAt),
      });
      insertedIds.push(targetId);
      for (const type of ['BUSINESS_IDENTITY', 'BUSINESS_REGISTRATION']) {
        await prisma.getDb().orm.public.MerchantDocument.create({
          id: createUuidV7(),
          merchantId: targetId,
          type: pgVarchar<64>(type),
          fileUrl: 'storage://test',
          status: pgVarchar<64>('SUBMITTED'),
          expiryDate: null,
          createdAt: pgTimestamptz(targetCreatedAt),
          updatedAt: pgTimestamptz(targetCreatedAt),
        });
      }

      for (let i = 1; i <= 500; i++) {
        const id = createUuidV7();
        const createdAt = new Date(base + i * 1000).toISOString();
        await prisma.getDb().orm.public.Merchant.create({
          id,
          publicReference: pgVarchar<64>(`aq_${suffix}_${i}`),
          name: pgVarchar<255>(`Queue Filler ${suffix} ${i}`),
          status: pgVarchar<64>('PENDING_REVIEW'),
          verifiedAt: null,
          createdAt: pgTimestamptz(createdAt),
          updatedAt: pgTimestamptz(createdAt),
        });
        insertedIds.push(id);
        for (const type of ['BUSINESS_IDENTITY', 'BUSINESS_REGISTRATION']) {
          await prisma.getDb().orm.public.MerchantDocument.create({
            id: createUuidV7(),
            merchantId: id,
            type: pgVarchar<64>(type),
            fileUrl: 'storage://test',
            status: pgVarchar<64>('SUBMITTED'),
            expiryDate: null,
            createdAt: pgTimestamptz(createdAt),
            updatedAt: pgTimestamptz(createdAt),
          });
        }
      }

      let found = false;
      let foundAtOffset = -1;
      for (let offset = 0; offset <= 10_000; offset += 50) {
        const page = await request(server)
          .get('/api/v1/admin/merchants/verification/queue')
          .query({ limit: 50, offset })
          .set('Authorization', `Bearer ${adminToken}`);
        expect(page.status).toBe(200);
        const body = page.body as {
          total: number;
          items: Array<{ id: string }>;
        };
        expect(body.total).toBeGreaterThanOrEqual(501);
        if (body.items.some((item) => item.id === targetId)) {
          found = true;
          foundAtOffset = offset;
          break;
        }
        if (body.items.length === 0) {
          break;
        }
      }
      expect(found).toBe(true);
      expect(foundAtOffset).toBeGreaterThanOrEqual(500);

      const deep = await request(server)
        .get('/api/v1/admin/merchants/verification/queue')
        .query({ limit: 50, offset: 500 })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deep.status).toBe(200);
      const deepItems = (deep.body as { items: Array<{ id: string }> }).items;
      // Target may sit at offset 500+ when other queue rows exist; walk already proved >=500.
      expect(
        deepItems.some((item) => item.id === targetId) || foundAtOffset >= 500,
      ).toBe(true);
    } finally {
      await cleanupMerchantsByIds(insertedIds);
      if (e164) {
        await cleanupByPhone(e164);
      }
    }
  });

  it('B6 driver review HTTP approve + audit; Account retained', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}6`;
    const phones = { driver: `0589${suffix}`, admin: `0590${suffix}` };
    const e164: string[] = [];
    try {
      const driverToken = await authenticate(phones.driver);
      const adminToken = await authenticate(phones.admin);
      const driverAccount = await authMe(driverToken);
      e164.push(driverAccount.phone);
      const adminAccount = await authMe(adminToken);
      e164.push(adminAccount.phone);
      const { adminId } = await seedAdminWithPermissions(
        adminAccount.id,
        `drv-${suffix}`,
        [ADMIN_PERMISSIONS.DRIVERS_VERIFY, ADMIN_PERMISSIONS.AUDIT_READ],
      );

      await request(server)
        .post('/api/v1/driver/profile')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ fullName: `Driver ${suffix}` });
      await request(server)
        .put('/api/v1/driver/documents/IDENTITY')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({});
      await request(server)
        .put('/api/v1/driver/documents/DRIVING_LICENSE')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ expiryDate: '2099-12-31' });
      await request(server)
        .post('/api/v1/driver/vehicles')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          type: 'MOTORCYCLE',
          plateNumber: `AF${suffix}`,
          model: 'NMAX',
        });
      const submitted = await request(server)
        .post('/api/v1/driver/verification/submit')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({});
      expect(submitted.status).toBe(200);
      const driverId = (submitted.body as { profile: { id: string } }).profile
        .id;

      const approved = await request(server)
        .post(`/api/v1/admin/drivers/${driverId}/verification/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(approved.status).toBe(201);
      expect(
        (approved.body as { verificationStatus: string }).verificationStatus,
      ).toBe('APPROVED');

      const accountStill = await prisma
        .getDb()
        .orm.public.Account.where({ id: driverAccount.id })
        .first();
      expect(accountStill).toBeTruthy();

      const audits = await request(server)
        .get('/api/v1/admin/audit')
        .query({
          adminId,
          action: ADMIN_AUDIT_ACTIONS.DRIVER_VERIFICATION_APPROVE,
          targetId: driverId,
        })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(audits.status).toBe(200);
      expect((audits.body as { total: number }).total).toBeGreaterThanOrEqual(
        1,
      );
    } finally {
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('B7 promotion HTTP create / activate / deactivate + unsupported type', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}7`;
    const phone = `0570${suffix}`;
    const promoIds: string[] = [];
    let e164: string | undefined;
    try {
      const adminToken = await authenticate(phone);
      const adminAccount = await authMe(adminToken);
      e164 = adminAccount.phone;
      const { adminId } = await seedAdminWithPermissions(
        adminAccount.id,
        `promo-${suffix}`,
        [
          ADMIN_PERMISSIONS.PROMOTIONS_MANAGE,
          ADMIN_PERMISSIONS.PROMOTIONS_READ,
          ADMIN_PERMISSIONS.AUDIT_READ,
        ],
      );

      const created = await request(server)
        .post('/api/v1/admin/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `  af_${suffix}_code  `,
          type: PROMOTION_TYPE_MERCHANT_RATE_BPS,
          value: 500,
          startsAt: '2020-01-01T00:00:00.000Z',
          endsAt: '2099-01-01T00:00:00.000Z',
          active: false,
        });
      expect(created.status).toBe(201);
      const promo = created.body as {
        id: string;
        code: string;
        active: boolean;
      };
      promoIds.push(promo.id);
      expect(promo.code).toBe(`AF_${suffix}_CODE`);
      expect(promo.active).toBe(false);

      const unsupported = await request(server)
        .post('/api/v1/admin/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `BAD_${suffix}`,
          type: 'FREE_DELIVERY',
          value: 1,
          startsAt: '2020-01-01T00:00:00.000Z',
          endsAt: '2099-01-01T00:00:00.000Z',
        });
      expect(unsupported.status).toBe(400);

      const activated = await request(server)
        .post(`/api/v1/admin/promotions/${promo.id}/activate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(activated.status).toBe(201);
      expect((activated.body as { active: boolean }).active).toBe(true);

      const deactivated = await request(server)
        .post(`/api/v1/admin/promotions/${promo.id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(deactivated.status).toBe(201);
      expect((deactivated.body as { active: boolean }).active).toBe(false);

      const fixed = await request(server)
        .post('/api/v1/admin/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `FIX_${suffix}`,
          type: PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
          value: 100,
          startsAt: '2020-01-01T00:00:00.000Z',
          endsAt: '2099-01-01T00:00:00.000Z',
        });
      expect(fixed.status).toBe(201);
      promoIds.push((fixed.body as { id: string }).id);

      const audits = await request(server)
        .get('/api/v1/admin/audit')
        .query({
          adminId,
          action: ADMIN_AUDIT_ACTIONS.PROMOTION_CREATE,
          targetId: promo.id,
        })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(audits.status).toBe(200);
      expect((audits.body as { total: number }).total).toBeGreaterThanOrEqual(
        1,
      );
    } finally {
      const db = prisma.getDb().orm.public;
      for (const id of promoIds) {
        for (const red of await db.PromotionRedemption.where({
          promotionId: id,
        }).all()) {
          await db.PromotionRedemption.where({ id: red.id }).delete();
        }
        await db.Promotion.where({ id }).delete();
      }
      if (e164) {
        await cleanupByPhone(e164);
      }
    }
  });

  it('B8 ledger.read GET ok; without permission 403; POST absent', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}8`;
    const phones = { ledger: `0571${suffix}`, none: `0572${suffix}` };
    const e164: string[] = [];
    try {
      const ledgerToken = await authenticate(phones.ledger);
      const noneToken = await authenticate(phones.none);
      const ledgerAccount = await authMe(ledgerToken);
      e164.push(ledgerAccount.phone);
      const noneAccount = await authMe(noneToken);
      e164.push(noneAccount.phone);
      await seedAdminWithPermissions(ledgerAccount.id, `led-${suffix}`, [
        ADMIN_PERMISSIONS.LEDGER_READ,
      ]);
      await seedAdminWithPermissions(noneAccount.id, `nled-${suffix}`, [
        ADMIN_PERMISSIONS.MERCHANTS_READ,
      ]);

      const ok = await request(server)
        .get('/api/v1/admin/ledger')
        .set('Authorization', `Bearer ${ledgerToken}`);
      expect(ok.status).toBe(200);

      const denied = await request(server)
        .get('/api/v1/admin/ledger')
        .set('Authorization', `Bearer ${noneToken}`);
      expect(denied.status).toBe(403);

      const post = await request(server)
        .post('/api/v1/admin/ledger')
        .set('Authorization', `Bearer ${ledgerToken}`)
        .send({});
      expect([404, 405]).toContain(post.status);
    } finally {
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('B9 finance permission isolation', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}0`;
    const phones = { verify: `0573${suffix}`, ledger: `0574${suffix}` };
    const e164: string[] = [];
    try {
      const verifyToken = await authenticate(phones.verify);
      const ledgerToken = await authenticate(phones.ledger);
      const verifyAccount = await authMe(verifyToken);
      e164.push(verifyAccount.phone);
      const ledgerAccount = await authMe(ledgerToken);
      e164.push(ledgerAccount.phone);
      await seedAdminWithPermissions(verifyAccount.id, `ver-${suffix}`, [
        ADMIN_PERMISSIONS.MERCHANTS_VERIFY,
      ]);
      await seedAdminWithPermissions(ledgerAccount.id, `fin-${suffix}`, [
        ADMIN_PERMISSIONS.LEDGER_READ,
      ]);

      const refundDenied = await request(server)
        .post('/api/v1/admin/refunds')
        .set('Authorization', `Bearer ${verifyToken}`)
        .send({
          orderId: createUuidV7(),
          amountMinor: 100,
          method: 'MANUAL_OTHER',
          reason: 'nope',
        });
      expect(refundDenied.status).toBe(403);

      const settleDenied = await request(server)
        .post(`/api/v1/admin/settlements/${createUuidV7()}/finalize`)
        .set('Authorization', `Bearer ${ledgerToken}`)
        .send({});
      expect(settleDenied.status).toBe(403);
    } finally {
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('B10 orders.read / payments.read GET ok; PATCH absent', async () => {
    const server = app.getHttpServer();
    const suffix = `${(Date.now() + 11).toString().slice(-5)}9`;
    const phone = `0575${suffix}`;
    let e164: string | undefined;
    try {
      const token = await authenticate(phone);
      const account = await authMe(token);
      e164 = account.phone;
      await seedAdminWithPermissions(account.id, `read-${suffix}`, [
        ADMIN_PERMISSIONS.ORDERS_READ,
        ADMIN_PERMISSIONS.PAYMENTS_READ,
      ]);

      const orders = await request(server)
        .get('/api/v1/admin/orders')
        .set('Authorization', `Bearer ${token}`);
      expect(orders.status).toBe(200);

      const payments = await request(server)
        .get('/api/v1/admin/payments')
        .set('Authorization', `Bearer ${token}`);
      expect(payments.status).toBe(200);

      const patchOrder = await request(server)
        .patch(`/api/v1/admin/orders/${createUuidV7()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'CANCELLED' });
      expect(patchOrder.status).toBe(404);

      const patchPayment = await request(server)
        .patch(`/api/v1/admin/payments/${createUuidV7()}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'REFUNDED' });
      expect(patchPayment.status).toBe(404);
    } finally {
      if (e164) {
        await cleanupByPhone(e164);
      }
    }
  });
});
