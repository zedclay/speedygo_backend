/**
 * Isolated e2e: platform commerce verticals + storefront covers.
 * Does not overlap other e2e jobs. Uses unique phones and synthetic artwork.
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
import { PermissionService } from '../src/modules/authorization/permission.service';
import { ADMIN_PERMISSIONS } from '../src/modules/admin/domain/admin-permissions';
import { ADMIN_AUDIT_ACTIONS } from '../src/modules/admin/domain/admin-audit-actions';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';
import { deleteBranchOpeningHours } from './helpers/ensure-branch-opening-hours';
import { syntheticCoverPng } from './helpers/synthetic-cover-png';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type AuthMeBody = { account: { id: string; phone: string } };
type MembershipBody = { merchantId: string };
type BranchBody = { id: string };
type VerticalBody = { id: string; slug: string; active: boolean };
type StorefrontList = {
  items: Array<{
    branchId: string;
    coverImageUrl: string | null;
    merchantId: string;
  }>;
  total: number;
  limit: number;
  offset: number;
};
type UploadBody = { uploadReference: string; purpose: string };

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Commerce verticals and storefront covers (e2e)', () => {
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
        deviceName: 'cv-cover-e2e',
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

  async function approveMerchant(merchantId: string): Promise<void> {
    const now = pgNow();
    await prisma
      .getDb()
      .orm.public.Merchant.where({ id: merchantId })
      .update({
        status: pgVarchar<64>('ACTIVE'),
        verifiedAt: now,
        updatedAt: now,
      });
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
      name: pgVarchar<128>(`cv-e2e-${suffix}`),
      description: null,
      active: true,
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
      displayName: pgVarchar<255>(`CV Admin ${suffix}`),
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
    const members = await db.MerchantMember.where({
      accountId: account.id,
    }).all();
    for (const member of members) {
      const branches = await db.MerchantBranch.where({
        merchantId: member.merchantId,
      }).all();
      for (const branch of branches) {
        const cover = await db.MerchantBranchCover.where({
          branchId: branch.id,
        }).first();
        if (cover) {
          await db.MerchantBranchCover.where({ id: cover.id }).delete();
        }
        const classification = await db.MerchantBranchClassification.where({
          branchId: branch.id,
        }).first();
        if (classification) {
          await db.MerchantBranchClassification.where({
            id: classification.id,
          }).delete();
        }
        await deleteBranchOpeningHours(prisma, branch.id);
        await db.MerchantBranch.where({ id: branch.id }).delete();
      }
      const leftoverMembers = await db.MerchantMember.where({
        merchantId: member.merchantId,
      }).all();
      for (const leftover of leftoverMembers) {
        await db.MerchantMember.where({ id: leftover.id }).delete();
      }
      const documents = await db.MerchantDocument.where({
        merchantId: member.merchantId,
      }).all();
      for (const document of documents) {
        await db.MerchantDocument.where({ id: document.id }).delete();
      }
      await db.Merchant.where({ id: member.merchantId }).delete();
    }
    const customer = await db.CustomerProfile.where({
      accountId: account.id,
    }).first();
    if (customer) {
      const addresses = await db.Address.where({
        customerId: customer.id,
      }).all();
      for (const address of addresses) {
        await db.Address.where({ id: address.id }).delete();
      }
      await db.CustomerProfile.where({ id: customer.id }).delete();
    }
    const sessions = await db.Session.where({ accountId: account.id }).all();
    for (const session of sessions) {
      await db.Session.where({ id: session.id }).delete();
    }
    const devices = await db.Device.where({ accountId: account.id }).all();
    for (const device of devices) {
      await db.Device.where({ id: device.id }).delete();
    }
    await deleteAccountNotificationArtifacts(prisma, account.id);
    await db.Account.where({ id: account.id }).delete();
  }

  it('covers authorization, visibility, filter, pagination, and cover isolation', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0591${suffix}`,
      merchant: `0592${suffix}`,
      merchantB: `0593${suffix}`,
      admin: `0594${suffix}`,
      adminDenied: `0595${suffix}`,
      pending: `0596${suffix}`,
    };
    const e164: string[] = [];
    const verticalIds: string[] = [];

    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenMerchant = await authenticate(phones.merchant);
      const tokenMerchantB = await authenticate(phones.merchantB);
      const tokenAdmin = await authenticate(phones.admin);
      const tokenDenied = await authenticate(phones.adminDenied);
      const tokenPending = await authenticate(phones.pending);
      e164.push(
        (await authMe(tokenCustomer)).phone,
        (await authMe(tokenMerchant)).phone,
        (await authMe(tokenMerchantB)).phone,
        (await authMe(tokenAdmin)).phone,
        (await authMe(tokenDenied)).phone,
        (await authMe(tokenPending)).phone,
      );
      const adminAccount = await authMe(tokenAdmin);
      await seedAdminWithPermissions(adminAccount.id, suffix, [
        ADMIN_PERMISSIONS.COMMERCE_VERTICALS_READ,
        ADMIN_PERMISSIONS.COMMERCE_VERTICALS_MANAGE,
        ADMIN_PERMISSIONS.STOREFRONT_COVERS_MANAGE,
      ]);
      await seedAdminWithPermissions((await authMe(tokenDenied)).id, `${suffix}d`, [
        ADMIN_PERMISSIONS.MERCHANTS_READ,
      ]);

      const unauthorized = await request(server).get(
        '/api/v1/customer/commerce-verticals',
      );
      expect(unauthorized.status).toBe(401);

      const deniedCreate = await request(server)
        .post('/api/v1/admin/commerce-verticals')
        .set('Authorization', `Bearer ${tokenDenied}`)
        .send({
          slug: `cv-e2e-${suffix}-x`,
          name: 'Denied',
          iconKey: 'restaurant',
          sortOrder: 0,
        });
      expect(deniedCreate.status).toBe(403);

      const created = await request(server)
        .post('/api/v1/admin/commerce-verticals')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          slug: `cv-e2e-${suffix}-food`,
          name: 'Restaurants',
          iconKey: 'restaurant',
          sortOrder: 0,
        });
      expect(created.status).toBe(201);
      const food = created.body as VerticalBody;
      verticalIds.push(food.id);

      const dessert = await request(server)
        .post('/api/v1/admin/commerce-verticals')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          slug: `cv-e2e-${suffix}-dessert`,
          name: 'Desserts',
          iconKey: 'icecream',
          sortOrder: 1,
        });
      expect(dessert.status).toBe(201);
      const dessertId = (dessert.body as VerticalBody).id;
      verticalIds.push(dessertId);

      const profile = await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'CV Cover Customer' });
      expect(profile.status).toBe(201);

      const listed = await request(server)
        .get('/api/v1/customer/commerce-verticals')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(listed.status).toBe(200);
      const listedIds = (
        listed.body as { items: Array<{ id: string }> }
      ).items.map((item) => item.id);
      expect(listedIds).toEqual(expect.arrayContaining([food.id, dessertId]));

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ name: 'CV Cover Cafe' });
      expect(merchant.status).toBe(201);
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const branchA = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'CV Classified Branch',
          phone: '0550111001',
          addressText: 'Rue Demo 1',
          latitude: 36.75,
          longitude: 3.05,
          wilayaCode: '16',
          communeId: 556,
        });
      const branchB = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'CV Unclassified Branch',
          phone: '0550111002',
          addressText: 'Rue Demo 2',
          latitude: 36.76,
          longitude: 3.06,
          wilayaCode: '16',
          communeId: 556,
        });
      expect(branchA.status).toBe(201);
      expect(branchB.status).toBe(201);
      const classifiedId = (branchA.body as BranchBody).id;
      const unclassifiedId = (branchB.body as BranchBody).id;
      await approveMerchant(merchantId);

      const hidden = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenMerchantB}`)
        .send({ name: 'Hidden CV Merchant' });
      const hiddenMerchantId = (hidden.body as MembershipBody).merchantId;
      const hiddenBranch = await request(server)
        .post(`/api/v1/merchant/${hiddenMerchantId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchantB}`)
        .send({
          name: 'Hidden Branch',
          phone: '0550111003',
          addressText: 'Rue Hidden',
          latitude: 36.77,
          longitude: 3.07,
          wilayaCode: '16',
          communeId: 556,
        });
      const hiddenBranchId = (hiddenBranch.body as BranchBody).id;

      const assign = await request(server)
        .put(`/api/v1/admin/merchant-branches/${classifiedId}/classification`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ verticalId: food.id });
      expect(assign.status).toBe(200);
      const audit = await prisma
        .getDb()
        .orm.public.AuditLog.where({
          action: pgVarchar<128>(ADMIN_AUDIT_ACTIONS.COMMERCE_VERTICAL_ASSIGN_BRANCH),
        })
        .all();
      expect(audit.some((row) => row.targetId === classifiedId)).toBe(true);

      const hiddenAssign = await request(server)
        .put(`/api/v1/admin/merchant-branches/${hiddenBranchId}/classification`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ verticalId: food.id });
      expect(hiddenAssign.status).toBe(200);

      const unfiltered = await request(server)
        .get('/api/v1/customer/branches')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(unfiltered.status).toBe(200);
      const unfilteredIds = (unfiltered.body as StorefrontList).items.map(
        (item) => item.branchId,
      );
      expect(unfilteredIds).toEqual(
        expect.arrayContaining([classifiedId, unclassifiedId]),
      );
      expect(unfilteredIds).not.toContain(hiddenBranchId);

      const filtered = await request(server)
        .get(`/api/v1/customer/branches?verticalId=${food.id}&limit=1&offset=0`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(filtered.status).toBe(200);
      const filteredBody = filtered.body as StorefrontList;
      expect(filteredBody.total).toBe(1);
      expect(filteredBody.items).toHaveLength(1);
      expect(filteredBody.items[0]?.branchId).toBe(classifiedId);
      expect(filteredBody.items[0]?.coverImageUrl).toBeNull();

      const page2 = await request(server)
        .get(`/api/v1/customer/branches?verticalId=${food.id}&limit=1&offset=1`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(page2.status).toBe(200);
      expect((page2.body as StorefrontList).items).toHaveLength(0);

      await request(server)
        .post(`/api/v1/admin/commerce-verticals/${food.id}/deactivate`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({});
      const stillUnfiltered = await request(server)
        .get('/api/v1/customer/branches')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      const stillIds = (stillUnfiltered.body as StorefrontList).items.map(
        (item) => item.branchId,
      );
      expect(stillIds).toEqual(
        expect.arrayContaining([classifiedId, unclassifiedId]),
      );
      const inactiveFilter = await request(server)
        .get(`/api/v1/customer/branches?verticalId=${food.id}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(inactiveFilter.status).toBe(404);
      expect((inactiveFilter.body as ErrorBody).error.code).toBe(
        'COMMERCE_VERTICAL_INACTIVE',
      );

      await request(server)
        .post(`/api/v1/admin/commerce-verticals/${food.id}/activate`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({});

      const missingVertical = await request(server)
        .get(`/api/v1/customer/branches?verticalId=${createUuidV7()}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(missingVertical.status).toBe(404);

      const tiny = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches/${classifiedId}/cover/content`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .attach('file', syntheticCoverPng(10, 10), {
          filename: 'tiny.png',
          contentType: 'image/png',
        });
      expect(tiny.status).toBe(400);

      const junk = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches/${classifiedId}/cover/content`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .attach('file', Buffer.from('not-an-image'), {
          filename: 'x.txt',
          contentType: 'text/plain',
        });
      expect(junk.status).toBe(400);

      const pendingMerchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenPending}`)
        .send({ name: 'Pending CV Isolation' });
      expect(pendingMerchant.status).toBe(201);
      const pendingMerchantId = (pendingMerchant.body as MembershipBody)
        .merchantId;
      const pendingBranch = await request(server)
        .post(`/api/v1/merchant/${pendingMerchantId}/branches`)
        .set('Authorization', `Bearer ${tokenPending}`)
        .send({
          name: 'Pending Isolation Branch',
          phone: '0550111004',
          addressText: 'Rue Isolation',
          latitude: 36.78,
          longitude: 3.08,
          wilayaCode: '16',
          communeId: 556,
        });
      expect(pendingBranch.status).toBe(201);
      const pendingBranchId = (pendingBranch.body as BranchBody).id;

      const verificationUpload = await request(server)
        .post(
          `/api/v1/merchant/${pendingMerchantId}/verification/documents/BUSINESS_IDENTITY/content`,
        )
        .set('Authorization', `Bearer ${tokenPending}`)
        .attach('file', PNG_1X1, {
          filename: 'id.png',
          contentType: 'image/png',
        });
      expect(verificationUpload.status).toBe(200);
      const bindVerificationAsCover = await request(server)
        .put(
          `/api/v1/merchant/${pendingMerchantId}/branches/${pendingBranchId}/cover`,
        )
        .set('Authorization', `Bearer ${tokenPending}`)
        .send({
          uploadReference: (verificationUpload.body as UploadBody)
            .uploadReference,
        });
      expect(bindVerificationAsCover.status).toBe(404);
      expect((bindVerificationAsCover.body as ErrorBody).error.code).toBe(
        'STORAGE_UPLOAD_REFERENCE_FOREIGN',
      );

      const isolationCover = await request(server)
        .post(
          `/api/v1/merchant/${pendingMerchantId}/branches/${pendingBranchId}/cover/content`,
        )
        .set('Authorization', `Bearer ${tokenPending}`)
        .attach('file', syntheticCoverPng(400, 400), {
          filename: 'cover-iso.png',
          contentType: 'image/png',
        });
      expect(isolationCover.status).toBe(200);
      const bindCoverAsVerification = await request(server)
        .put(
          `/api/v1/merchant/${pendingMerchantId}/verification/documents/BUSINESS_IDENTITY`,
        )
        .set('Authorization', `Bearer ${tokenPending}`)
        .send({
          uploadReference: (isolationCover.body as UploadBody).uploadReference,
        });
      expect(bindCoverAsVerification.status).toBe(404);
      expect((bindCoverAsVerification.body as ErrorBody).error.code).toBe(
        'STORAGE_UPLOAD_REFERENCE_FOREIGN',
      );

      const coverUpload = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches/${classifiedId}/cover/content`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .attach('file', syntheticCoverPng(400, 400), {
          filename: 'cover-demo.png',
          contentType: 'image/png',
        });
      expect(coverUpload.status).toBe(200);
      expect((coverUpload.body as UploadBody).purpose).toBe(
        'MERCHANT_BRANCH_COVER',
      );
      const foreignBind = await request(server)
        .put(
          `/api/v1/merchant/${hiddenMerchantId}/branches/${hiddenBranchId}/cover`,
        )
        .set('Authorization', `Bearer ${tokenMerchantB}`)
        .send({
          uploadReference: (coverUpload.body as UploadBody).uploadReference,
        });
      expect(foreignBind.status).toBe(404);

      const siblingBind = await request(server)
        .put(`/api/v1/merchant/${merchantId}/branches/${unclassifiedId}/cover`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          uploadReference: (coverUpload.body as UploadBody).uploadReference,
        });
      expect(siblingBind.status).toBe(404);
      expect((siblingBind.body as ErrorBody).error.code).toBe(
        'STORAGE_UPLOAD_REFERENCE_FOREIGN',
      );

      const bind = await request(server)
        .put(`/api/v1/merchant/${merchantId}/branches/${classifiedId}/cover`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          uploadReference: (coverUpload.body as UploadBody).uploadReference,
        });
      expect(bind.status).toBe(200);
      expect((bind.body as { coverImageUrl: string }).coverImageUrl).toBe(
        `/customer/branches/${classifiedId}/cover`,
      );

      const merchantCoverStream = await request(server)
        .get(`/api/v1/merchant/${merchantId}/branches/${classifiedId}/cover`)
        .set('Authorization', `Bearer ${tokenMerchant}`);
      expect(merchantCoverStream.status).toBe(200);
      expect(merchantCoverStream.headers['content-type']).toMatch(/image\//);

      const merchantCoverMissing = await request(server)
        .get(`/api/v1/merchant/${merchantId}/branches/${unclassifiedId}/cover`)
        .set('Authorization', `Bearer ${tokenMerchant}`);
      expect(merchantCoverMissing.status).toBe(404);
      expect((merchantCoverMissing.body as ErrorBody).error.code).toBe(
        'STORAGE_OBJECT_MISSING',
      );

      const withCover = await request(server)
        .get(`/api/v1/customer/branches/${classifiedId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(withCover.status).toBe(200);
      expect(
        (withCover.body as { coverImageUrl: string | null }).coverImageUrl,
      ).toBe(`/customer/branches/${classifiedId}/cover`);

      const coverBytes = await request(server)
        .get(`/api/v1/customer/branches/${classifiedId}/cover`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(coverBytes.status).toBe(200);
      expect(coverBytes.headers['content-type']).toMatch(/image\/png/);

      const hiddenCover = await request(server)
        .get(`/api/v1/customer/branches/${hiddenBranchId}/cover`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(hiddenCover.status).toBe(404);
      expect((hiddenCover.body as ErrorBody).error.code).toBe(
        'CUSTOMER_STOREFRONT_NOT_FOUND',
      );

      const deniedCover = await request(server)
        .post(
          `/api/v1/admin/merchant-branches/${unclassifiedId}/cover/content`,
        )
        .set('Authorization', `Bearer ${tokenDenied}`)
        .attach('file', syntheticCoverPng(400, 400), {
          filename: 'admin.png',
          contentType: 'image/png',
        });
      expect(deniedCover.status).toBe(403);
    } finally {
      for (const id of verticalIds) {
        const rows = await prisma
          .getDb()
          .orm.public.MerchantBranchClassification.where({ verticalId: id })
          .all();
        for (const row of rows) {
          await prisma
            .getDb()
            .orm.public.MerchantBranchClassification.where({ id: row.id })
            .delete();
        }
        await prisma
          .getDb()
          .orm.public.CommerceVertical.where({ id })
          .delete();
      }
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });
});
