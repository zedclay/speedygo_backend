/**
 * Isolated e2e: merchant/admin/customer product images.
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
type CategoryBody = { id: string };
type ProductBody = { id: string; available: boolean };
type UploadBody = { uploadReference: string; purpose: string };
type ProductList = {
  items: Array<{ productId: string; imageUrl: string | null; priceMinor: string }>;
};

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Product images (e2e)', () => {
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
        deviceName: 'product-image-e2e',
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
  ): Promise<void> {
    const now = pgNow();
    const roleId = createUuidV7();
    await prisma.getDb().orm.public.Role.create({
      id: roleId,
      name: pgVarchar<128>(`pi-e2e-${suffix}`),
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
    await prisma.getDb().orm.public.AdminProfile.create({
      id: createUuidV7(),
      accountId,
      roleId,
      displayName: pgVarchar<255>(`PI Admin ${suffix}`),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await permissions.invalidate(accountId);
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
        const products = await db.Product.where({
          merchantBranchId: branch.id,
        }).all();
        for (const product of products) {
          const image = await db.ProductImage.where({
            productId: product.id,
          }).first();
          if (image) {
            await db.ProductImage.where({ id: image.id }).delete();
          }
          await db.Product.where({ id: product.id }).delete();
        }
        const categories = await db.Category.where({
          merchantBranchId: branch.id,
        }).all();
        for (const category of categories) {
          await db.Category.where({ id: category.id }).delete();
        }
        const cover = await db.MerchantBranchCover.where({
          branchId: branch.id,
        }).first();
        if (cover) {
          await db.MerchantBranchCover.where({ id: cover.id }).delete();
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

  it('covers ownership, visibility, invalid images, isolation, and replacement', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0541${suffix}`,
      merchant: `0542${suffix}`,
      merchantB: `0543${suffix}`,
      admin: `0544${suffix}`,
      adminDenied: `0545${suffix}`,
      pending: `0546${suffix}`,
    };
    const e164: string[] = [];

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
      await seedAdminWithPermissions((await authMe(tokenAdmin)).id, suffix, [
        ADMIN_PERMISSIONS.PRODUCT_IMAGES_MANAGE,
      ]);
      await seedAdminWithPermissions(
        (await authMe(tokenDenied)).id,
        `${suffix}d`,
        [ADMIN_PERMISSIONS.MERCHANTS_READ],
      );

      const profile = await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'PI Customer' });
      expect(profile.status).toBe(201);

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ name: 'PI Cafe' });
      expect(merchant.status).toBe(201);
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'PI Main',
          phone: '0550112001',
          addressText: 'Rue Image 1',
          latitude: 36.75,
          longitude: 3.05,
          wilayaCode: '16',
          communeId: 556,
        });
      expect(branch.status).toBe(201);
      const branchId = (branch.body as BranchBody).id;
      const sibling = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'PI Sibling',
          phone: '0550112002',
          addressText: 'Rue Image 2',
          latitude: 36.76,
          longitude: 3.06,
          wilayaCode: '16',
          communeId: 556,
        });
      const siblingId = (sibling.body as BranchBody).id;
      await approveMerchant(merchantId);

      const category = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ branchId, name: 'Drinks' });
      expect(category.status).toBe(201);
      const categoryId = (category.body as CategoryBody).id;
      const product = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          branchId,
          categoryId,
          name: 'Espresso Photo',
          priceMinor: 1200,
        });
      expect(product.status).toBe(201);
      const productId = (product.body as ProductBody).id;
      const productB = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          branchId,
          categoryId,
          name: 'Tea Photo',
          priceMinor: 800,
        });
      const productBId = (productB.body as ProductBody).id;

      const hidden = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenMerchantB}`)
        .send({ name: 'Hidden PI Merchant' });
      const hiddenMerchantId = (hidden.body as MembershipBody).merchantId;
      const hiddenBranch = await request(server)
        .post(`/api/v1/merchant/${hiddenMerchantId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchantB}`)
        .send({
          name: 'Hidden PI Branch',
          phone: '0550112003',
          addressText: 'Rue Hidden Image',
          latitude: 36.77,
          longitude: 3.07,
          wilayaCode: '16',
          communeId: 556,
        });
      const hiddenBranchId = (hiddenBranch.body as BranchBody).id;
      const hiddenCategory = await request(server)
        .post(`/api/v1/merchant/${hiddenMerchantId}/categories`)
        .set('Authorization', `Bearer ${tokenMerchantB}`)
        .send({ branchId: hiddenBranchId, name: 'Hidden' });
      const hiddenProduct = await request(server)
        .post(`/api/v1/merchant/${hiddenMerchantId}/products`)
        .set('Authorization', `Bearer ${tokenMerchantB}`)
        .send({
          branchId: hiddenBranchId,
          categoryId: (hiddenCategory.body as CategoryBody).id,
          name: 'Hidden Coffee',
          priceMinor: 500,
        });
      const hiddenProductId = (hiddenProduct.body as ProductBody).id;

      const tiny = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/products/${productId}/image/content`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .attach('file', syntheticCoverPng(10, 10), {
          filename: 'tiny.png',
          contentType: 'image/png',
        });
      expect(tiny.status).toBe(400);

      const junk = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/products/${productId}/image/content`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .attach('file', Buffer.from('not-an-image'), {
          filename: 'x.txt',
          contentType: 'text/plain',
        });
      expect(junk.status).toBe(400);

      const pendingMerchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenPending}`)
        .send({ name: 'Pending PI Isolation' });
      const pendingMerchantId = (pendingMerchant.body as MembershipBody)
        .merchantId;
      const pendingBranch = await request(server)
        .post(`/api/v1/merchant/${pendingMerchantId}/branches`)
        .set('Authorization', `Bearer ${tokenPending}`)
        .send({
          name: 'Pending PI Branch',
          phone: '0550112004',
          addressText: 'Rue Isolation Image',
          latitude: 36.78,
          longitude: 3.08,
          wilayaCode: '16',
          communeId: 556,
        });
      const pendingBranchId = (pendingBranch.body as BranchBody).id;
      const pendingCategory = await request(server)
        .post(`/api/v1/merchant/${pendingMerchantId}/categories`)
        .set('Authorization', `Bearer ${tokenPending}`)
        .send({ branchId: pendingBranchId, name: 'Pending' });
      const pendingProduct = await request(server)
        .post(`/api/v1/merchant/${pendingMerchantId}/products`)
        .set('Authorization', `Bearer ${tokenPending}`)
        .send({
          branchId: pendingBranchId,
          categoryId: (pendingCategory.body as CategoryBody).id,
          name: 'Pending Item',
          priceMinor: 100,
        });
      const pendingProductId = (pendingProduct.body as ProductBody).id;

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
      const bindVerificationAsImage = await request(server)
        .put(
          `/api/v1/merchant/${pendingMerchantId}/branches/${pendingBranchId}/products/${pendingProductId}/image`,
        )
        .set('Authorization', `Bearer ${tokenPending}`)
        .send({
          uploadReference: (verificationUpload.body as UploadBody)
            .uploadReference,
        });
      expect(bindVerificationAsImage.status).toBe(404);
      expect((bindVerificationAsImage.body as ErrorBody).error.code).toBe(
        'STORAGE_UPLOAD_REFERENCE_FOREIGN',
      );

      const coverUpload = await request(server)
        .post(
          `/api/v1/merchant/${pendingMerchantId}/branches/${pendingBranchId}/cover/content`,
        )
        .set('Authorization', `Bearer ${tokenPending}`)
        .attach('file', syntheticCoverPng(400, 400), {
          filename: 'cover.png',
          contentType: 'image/png',
        });
      expect(coverUpload.status).toBe(200);
      const bindCoverAsImage = await request(server)
        .put(
          `/api/v1/merchant/${pendingMerchantId}/branches/${pendingBranchId}/products/${pendingProductId}/image`,
        )
        .set('Authorization', `Bearer ${tokenPending}`)
        .send({
          uploadReference: (coverUpload.body as UploadBody).uploadReference,
        });
      expect(bindCoverAsImage.status).toBe(404);
      expect((bindCoverAsImage.body as ErrorBody).error.code).toBe(
        'STORAGE_UPLOAD_REFERENCE_FOREIGN',
      );

      const productUpload = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/products/${productId}/image/content`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .attach('file', syntheticCoverPng(400, 400), {
          filename: 'product.png',
          contentType: 'image/png',
        });
      expect(productUpload.status).toBe(200);
      expect((productUpload.body as UploadBody).purpose).toBe('PRODUCT_IMAGE');

      const bindAsCover = await request(server)
        .put(`/api/v1/merchant/${merchantId}/branches/${branchId}/cover`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          uploadReference: (productUpload.body as UploadBody).uploadReference,
        });
      expect(bindAsCover.status).toBe(404);
      expect((bindAsCover.body as ErrorBody).error.code).toBe(
        'STORAGE_UPLOAD_REFERENCE_FOREIGN',
      );

      const foreignBind = await request(server)
        .put(
          `/api/v1/merchant/${hiddenMerchantId}/branches/${hiddenBranchId}/products/${hiddenProductId}/image`,
        )
        .set('Authorization', `Bearer ${tokenMerchantB}`)
        .send({
          uploadReference: (productUpload.body as UploadBody).uploadReference,
        });
      expect(foreignBind.status).toBe(404);

      const crossProduct = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/products/${productBId}/image`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          uploadReference: (productUpload.body as UploadBody).uploadReference,
        });
      expect(crossProduct.status).toBe(404);
      expect((crossProduct.body as ErrorBody).error.code).toBe(
        'STORAGE_UPLOAD_REFERENCE_FOREIGN',
      );

      const crossBranch = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${siblingId}/products/${productId}/image`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          uploadReference: (productUpload.body as UploadBody).uploadReference,
        });
      expect(crossBranch.status).toBe(404);

      const bind = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/products/${productId}/image`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          uploadReference: (productUpload.body as UploadBody).uploadReference,
        });
      expect(bind.status).toBe(200);
      const expectedUrl = `/customer/branches/${branchId}/products/${productId}/image`;
      expect((bind.body as { imageUrl: string }).imageUrl).toBe(expectedUrl);

      const merchantStream = await request(server)
        .get(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/products/${productId}/image`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`);
      expect(merchantStream.status).toBe(200);
      expect(merchantStream.headers['content-type']).toMatch(/^image\//);
      expect(Buffer.isBuffer(merchantStream.body) || merchantStream.body).toBeTruthy();

      const merchantMissing = await request(server)
        .get(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/products/${productBId}/image`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`);
      expect(merchantMissing.status).toBe(404);
      expect((merchantMissing.body as ErrorBody).error.code).toBe(
        'STORAGE_OBJECT_MISSING',
      );

      const listed = await request(server)
        .get(`/api/v1/customer/branches/${branchId}/products`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(listed.status).toBe(200);
      const espresso = (listed.body as ProductList).items.find(
        (item) => item.productId === productId,
      );
      expect(espresso?.imageUrl).toBe(expectedUrl);
      expect(espresso?.priceMinor).toBe('1200');
      const tea = (listed.body as ProductList).items.find(
        (item) => item.productId === productBId,
      );
      expect(tea?.imageUrl).toBeNull();

      const detail = await request(server)
        .get(`/api/v1/customer/branches/${branchId}/products/${productId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(detail.status).toBe(200);
      expect((detail.body as { imageUrl: string | null }).imageUrl).toBe(
        expectedUrl,
      );

      const search = await request(server)
        .get('/api/v1/customer/catalog/search?q=Espresso')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(search.status).toBe(200);
      const hit = (
        search.body as {
          items: Array<{
            type: string;
            product?: { imageUrl: string | null; productId: string };
            storefront?: { coverImageUrl: string | null };
          }>;
        }
      ).items.find(
        (item) =>
          item.type === 'PRODUCT' && item.product?.productId === productId,
      );
      expect(hit?.product?.imageUrl).toBe(expectedUrl);
      expect(hit?.storefront?.coverImageUrl).toBeNull();

      const bytes = await request(server)
        .get(`/api/v1/customer/branches/${branchId}/products/${productId}/image`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(bytes.status).toBe(200);
      expect(bytes.headers['content-type']).toMatch(/image\/png/);
      expect(JSON.stringify(bytes.body)).not.toMatch(/sg-product-image:v1:/);
      expect(JSON.stringify(bytes.body)).not.toMatch(/product-images\//);

      const hiddenRead = await request(server)
        .get(
          `/api/v1/customer/branches/${hiddenBranchId}/products/${hiddenProductId}/image`,
        )
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(hiddenRead.status).toBe(404);
      expect((hiddenRead.body as ErrorBody).error.code).toBe(
        'CUSTOMER_PRODUCT_NOT_FOUND',
      );

      await request(server)
        .patch(`/api/v1/merchant/${merchantId}/products/${productId}`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ available: false });
      const unavailable = await request(server)
        .get(`/api/v1/customer/branches/${branchId}/products/${productId}/image`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(unavailable.status).toBe(404);
      expect((unavailable.body as ErrorBody).error.code).toBe(
        'CUSTOMER_PRODUCT_NOT_FOUND',
      );
      await request(server)
        .patch(`/api/v1/merchant/${merchantId}/products/${productId}`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ available: true });

      const replaceUpload = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/products/${productId}/image/content`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .attach('file', syntheticCoverPng(500, 500), {
          filename: 'replace.png',
          contentType: 'image/png',
        });
      expect(replaceUpload.status).toBe(200);
      const replace = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/products/${productId}/image`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          uploadReference: (replaceUpload.body as UploadBody).uploadReference,
        });
      expect(replace.status).toBe(200);

      const denied = await request(server)
        .post(`/api/v1/admin/products/${productId}/image/content`)
        .set('Authorization', `Bearer ${tokenDenied}`)
        .attach('file', syntheticCoverPng(400, 400), {
          filename: 'admin.png',
          contentType: 'image/png',
        });
      expect(denied.status).toBe(403);

      const adminUpload = await request(server)
        .post(`/api/v1/admin/products/${productId}/image/content`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .attach('file', syntheticCoverPng(420, 420), {
          filename: 'admin.png',
          contentType: 'image/png',
        });
      expect([200, 201]).toContain(adminUpload.status);
      const adminBind = await request(server)
        .put(`/api/v1/admin/products/${productId}/image`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          uploadReference: (adminUpload.body as UploadBody).uploadReference,
        });
      expect(adminBind.status).toBe(200);
      const audit = await prisma
        .getDb()
        .orm.public.AuditLog.where({
          action: pgVarchar<128>(ADMIN_AUDIT_ACTIONS.PRODUCT_IMAGE_BIND),
        })
        .all();
      expect(audit.some((row) => row.targetId === productId)).toBe(true);
    } finally {
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });
});
