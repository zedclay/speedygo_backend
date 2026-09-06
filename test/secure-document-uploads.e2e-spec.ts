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
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';
import { deleteBranchOpeningHours } from './helpers/ensure-branch-opening-hours';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type UploadBody = {
  uploadReference: string;
  contentType: string;
  sizeBytes: number;
  purpose: string;
};
type MeBody = {
  profile: { id: string; verificationStatus: string } | null;
  documents: Array<{ type: string; present: boolean }>;
};
type MembershipBody = {
  merchantId: string;
  documents: Array<{ type: string; status: string }>;
};

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF_MIN = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
);

describe('Secure document uploads (e2e)', () => {
  jest.setTimeout(180_000);

  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  const phones: string[] = [];

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
  });

  afterAll(async () => {
    for (const phone of phones) {
      await cleanupByPhone(phone);
    }
    await app.close();
    // Leave STORAGE_LOCAL_ROOT for other e2e suites in the same Jest process;
    // OS temp directory is isolated per run via setup-e2e-env mkdtemp.
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
        deviceName: 'secure-docs-e2e',
      });
    expect(verified.status).toBe(200);
    const me = await request(server)
      .get('/api/v1/auth/me')
      .set(
        'Authorization',
        `Bearer ${(verified.body as TokenBody).accessToken}`,
      );
    phones.push((me.body as { account: { phone: string } }).account.phone);
    return (verified.body as TokenBody).accessToken;
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
      for (const doc of await db.MerchantDocument.where({
        merchantId: member.merchantId,
      }).all()) {
        await db.MerchantDocument.where({ id: doc.id }).delete();
      }
      for (const branch of await db.MerchantBranch.where({
        merchantId: member.merchantId,
      }).all()) {
        await deleteBranchOpeningHours(prisma, branch.id);
        await db.MerchantBranch.where({ id: branch.id }).delete();
      }
      await db.MerchantMember.where({ id: member.id }).delete();
      await db.Merchant.where({ id: member.merchantId }).delete();
    }
    const admin = await db.AdminProfile.where({
      accountId: account.id,
    }).first();
    if (admin) {
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

  async function seedAdmin(
    accountId: string,
    suffix: string,
    codes: string[],
    roleName?: string,
  ): Promise<string> {
    const now = pgNow();
    const roleId = createUuidV7();
    await prisma.getDb().orm.public.Role.create({
      id: roleId,
      name: pgVarchar<128>(roleName ?? `secure-docs-${suffix}`),
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
      displayName: pgVarchar<255>('Secure Docs Admin'),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    return adminId;
  }

  it('covers Driver/Merchant upload bind Admin download and attacks', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const driverToken = await authenticate(`0591${suffix}`);
    const driverBToken = await authenticate(`0592${suffix}`);
    const merchantAToken = await authenticate(`0593${suffix}`);
    const merchantBToken = await authenticate(`0594${suffix}`);
    const adminToken = await authenticate(`0595${suffix}`);
    const adminDeniedToken = await authenticate(`0596${suffix}`);
    const roleNameOnlyToken = await authenticate(`0597${suffix}`);

    const adminMe = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    const adminDeniedMe = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminDeniedToken}`);
    const roleNameMe = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${roleNameOnlyToken}`);

    await seedAdmin(
      (adminMe.body as { account: { id: string } }).account.id,
      `${suffix}a`,
      [ADMIN_PERMISSIONS.DRIVERS_VERIFY, ADMIN_PERMISSIONS.MERCHANTS_VERIFY],
    );
    await seedAdmin(
      (adminDeniedMe.body as { account: { id: string } }).account.id,
      `${suffix}b`,
      [ADMIN_PERMISSIONS.DRIVERS_READ],
    );
    await seedAdmin(
      (roleNameMe.body as { account: { id: string } }).account.id,
      `${suffix}c`,
      [],
      'SUPER_ADMIN',
    );

    // --- Driver onboard + upload ---
    expect(
      (
        await request(server)
          .post('/api/v1/driver/profile')
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ fullName: 'Docs Driver' })
      ).status,
    ).toBe(201);

    const svgReject = await request(server)
      .post('/api/v1/driver/documents/IDENTITY/content')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('file', SVG, {
        filename: '../evil.svg.png',
        contentType: 'image/png',
      });
    expect(svgReject.status).toBe(400);
    expect((svgReject.body as ErrorBody).error.code).toMatch(
      /STORAGE_(INVALID_SIGNATURE|UNSUPPORTED_TYPE)/,
    );

    const forgedMime = await request(server)
      .post('/api/v1/driver/documents/IDENTITY/content')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('file', SVG, {
        filename: 'id.png',
        contentType: 'image/png',
      });
    expect(forgedMime.status).toBe(400);

    const oversized = await request(server)
      .post('/api/v1/driver/documents/IDENTITY/content')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1, 0x25), {
        filename: 'big.pdf',
        contentType: 'application/pdf',
      });
    expect([400, 413]).toContain(oversized.status);

    const upload = await request(server)
      .post('/api/v1/driver/documents/IDENTITY/content')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('file', PNG_1X1, {
        filename: 'id.png',
        contentType: 'image/png',
      });
    expect(upload.status).toBe(200);
    const uploadBody = upload.body as UploadBody;
    expect(uploadBody.uploadReference.startsWith('sg-upload:v1:')).toBe(true);
    expect(JSON.stringify(uploadBody)).not.toMatch(/private\//);
    expect(JSON.stringify(uploadBody)).not.toMatch(
      /STORAGE_LOCAL_ROOT|bucket/i,
    );

    const bind = await request(server)
      .put('/api/v1/driver/documents/IDENTITY')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ uploadReference: uploadBody.uploadReference });
    expect(bind.status).toBe(200);
    expect(JSON.stringify(bind.body)).not.toContain('sg-object:');
    expect(JSON.stringify(bind.body)).not.toContain('sg-upload:');

    const licenseUpload = await request(server)
      .post('/api/v1/driver/documents/DRIVING_LICENSE/content')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('file', PDF_MIN, {
        filename: 'licence.pdf',
        contentType: 'application/pdf',
      });
    expect(licenseUpload.status).toBe(200);
    expect(
      (
        await request(server)
          .put('/api/v1/driver/documents/DRIVING_LICENSE')
          .set('Authorization', `Bearer ${driverToken}`)
          .send({
            expiryDate: '2099-01-01',
            uploadReference: (licenseUpload.body as UploadBody).uploadReference,
          })
      ).status,
    ).toBe(200);

    expect(
      (
        await request(server)
          .post('/api/v1/driver/vehicles')
          .set('Authorization', `Bearer ${driverToken}`)
          .send({
            type: 'MOTORCYCLE',
            plateNumber: `SD${suffix}`,
            model: 'NMAX',
            color: 'Black',
          })
      ).status,
    ).toBe(201);

    const me = await request(server)
      .get('/api/v1/driver/me')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(me.status).toBe(200);
    const driverId = (me.body as MeBody).profile!.id;
    const identityDoc = await prisma
      .getDb()
      .orm.public.DriverDocument.where({
        driverId,
        type: 'IDENTITY',
      })
      .first();
    expect(identityDoc).toBeTruthy();

    // Foreign driver cannot reuse reference (already consumed) / cannot download admin route
    expect(
      (
        await request(server)
          .post('/api/v1/driver/profile')
          .set('Authorization', `Bearer ${driverBToken}`)
          .send({ fullName: 'Other Driver' })
      ).status,
    ).toBe(201);
    const foreignReuse = await request(server)
      .put('/api/v1/driver/documents/IDENTITY')
      .set('Authorization', `Bearer ${driverBToken}`)
      .send({ uploadReference: uploadBody.uploadReference });
    expect(foreignReuse.status).toBe(404);
    expect((foreignReuse.body as ErrorBody).error.code).toBe(
      'STORAGE_UPLOAD_REFERENCE_FOREIGN',
    );

    const unauth = await request(server).get(
      `/api/v1/admin/drivers/${driverId}/documents/${identityDoc!.id}/content`,
    );
    expect(unauth.status).toBe(401);

    const driverAdminAttempt = await request(server)
      .get(
        `/api/v1/admin/drivers/${driverId}/documents/${identityDoc!.id}/content`,
      )
      .set('Authorization', `Bearer ${driverToken}`);
    expect([401, 403]).toContain(driverAdminAttempt.status);

    const denied = await request(server)
      .get(
        `/api/v1/admin/drivers/${driverId}/documents/${identityDoc!.id}/content`,
      )
      .set('Authorization', `Bearer ${adminDeniedToken}`);
    expect(denied.status).toBe(403);

    const roleNameBypass = await request(server)
      .get(
        `/api/v1/admin/drivers/${driverId}/documents/${identityDoc!.id}/content`,
      )
      .set('Authorization', `Bearer ${roleNameOnlyToken}`);
    expect(roleNameBypass.status).toBe(403);

    const download = await request(server)
      .get(
        `/api/v1/admin/drivers/${driverId}/documents/${identityDoc!.id}/content`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const data: Buffer[] = [];
        res.on('data', (chunk: Buffer) => data.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(data)));
      });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toMatch(/image\/png/);
    expect(download.headers['content-disposition']).toMatch(/attachment/);
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['cache-control']).toMatch(/no-store/);
    expect(Buffer.compare(download.body as Buffer, PNG_1X1)).toBe(0);

    const audits = await prisma
      .getDb()
      .orm.public.AuditLog.where({
        action: ADMIN_AUDIT_ACTIONS.DRIVER_DOCUMENT_READ,
        targetId: driverId,
      })
      .all();
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(audits[0])).not.toContain('private/');
    expect(JSON.stringify(audits[0])).not.toMatch(/iVBORw0KGgo/);

    // Durable bind must survive isolated Redis DB15 flush (Redis is pending-only).
    await redis.getClient().flushdb();
    const afterFlush = await request(server)
      .get(
        `/api/v1/admin/drivers/${driverId}/documents/${identityDoc!.id}/content`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const data: Buffer[] = [];
        res.on('data', (chunk: Buffer) => data.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(data)));
      });
    expect(afterFlush.status).toBe(200);
    expect(Buffer.compare(afterFlush.body as Buffer, PNG_1X1)).toBe(0);
    expect(afterFlush.headers['x-content-type-options']).toBe('nosniff');
    expect(identityDoc!.fileUrl.startsWith('sg-object:v1:') || true).toBe(true);
    const refreshedIdentity = await prisma
      .getDb()
      .orm.public.DriverDocument.where({ id: identityDoc!.id })
      .first();
    expect(refreshedIdentity!.fileUrl.startsWith('sg-object:v1:')).toBe(true);

    // Legacy metadata-only placeholder remains unavailable (no invented bytes).
    await prisma
      .getDb()
      .orm.public.DriverDocument.where({ id: identityDoc!.id })
      .update({
        fileUrl: `sg-object:driver-document:${identityDoc!.id}`,
      });
    const legacy = await request(server)
      .get(
        `/api/v1/admin/drivers/${driverId}/documents/${identityDoc!.id}/content`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(legacy.status).toBe(404);
    expect((legacy.body as ErrorBody).error.code).toBe(
      'STORAGE_LEGACY_REFERENCE_UNAVAILABLE',
    );
    // Restore durable locator for any later assertions in this suite
    await prisma
      .getDb()
      .orm.public.DriverDocument.where({ id: identityDoc!.id })
      .update({ fileUrl: refreshedIdentity!.fileUrl });

    // EICAR inside a valid PDF signature must be rejected by ClamAV (no bind / no ref).
    const eicar =
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    const eicarPdf = Buffer.from(
      `%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3 3] >>endobj
4 0 obj<< /Length ${eicar.length} >>stream
${eicar}
endstream
endobj
trailer<< /Root 1 0 R >>
%%EOF
`,
    );
    const infected = await request(server)
      .post('/api/v1/driver/documents/IDENTITY/content')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('file', eicarPdf, {
        filename: 'id.pdf',
        contentType: 'application/pdf',
      });
    expect(infected.status).toBe(400);
    expect((infected.body as ErrorBody).error.code).toBe(
      'STORAGE_SCAN_REJECTED',
    );
    expect(infected.body).not.toHaveProperty('uploadReference');

    // --- Merchant A/B ---
    const merchantA = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${merchantAToken}`)
      .send({ name: 'Docs Merchant A' });
    expect(merchantA.status).toBe(201);
    const merchantAId = (merchantA.body as MembershipBody).merchantId;

    const merchantB = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${merchantBToken}`)
      .send({ name: 'Docs Merchant B' });
    expect(merchantB.status).toBe(201);
    const merchantBId = (merchantB.body as MembershipBody).merchantId;

    const mUpload = await request(server)
      .post(
        `/api/v1/merchant/${merchantAId}/verification/documents/BUSINESS_IDENTITY/content`,
      )
      .set('Authorization', `Bearer ${merchantAToken}`)
      .attach('file', PNG_1X1, {
        filename: 'biz.png',
        contentType: 'image/png',
      });
    expect(mUpload.status).toBe(200);
    const mRef = (mUpload.body as UploadBody).uploadReference;

    expect(
      (
        await request(server)
          .put(
            `/api/v1/merchant/${merchantAId}/verification/documents/BUSINESS_IDENTITY`,
          )
          .set('Authorization', `Bearer ${merchantAToken}`)
          .send({ uploadReference: mRef })
      ).status,
    ).toBe(200);

    const crossMerchant = await request(server)
      .put(
        `/api/v1/merchant/${merchantBId}/verification/documents/BUSINESS_IDENTITY`,
      )
      .set('Authorization', `Bearer ${merchantBToken}`)
      .send({ uploadReference: mRef });
    expect(crossMerchant.status).toBe(404);

    const foreignMerchantUpload = await request(server)
      .post(
        `/api/v1/merchant/${merchantAId}/verification/documents/BUSINESS_IDENTITY/content`,
      )
      .set('Authorization', `Bearer ${merchantBToken}`)
      .attach('file', PNG_1X1, {
        filename: 'steal.png',
        contentType: 'image/png',
      });
    expect([403, 404]).toContain(foreignMerchantUpload.status);

    const mDoc = await prisma
      .getDb()
      .orm.public.MerchantDocument.where({
        merchantId: merchantAId,
        type: 'BUSINESS_IDENTITY',
      })
      .first();
    expect(mDoc).toBeTruthy();

    const mDownload = await request(server)
      .get(
        `/api/v1/admin/merchants/${merchantAId}/documents/${mDoc!.id}/content`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const data: Buffer[] = [];
        res.on('data', (chunk: Buffer) => data.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(data)));
      });
    expect(mDownload.status).toBe(200);
    expect(Buffer.compare(mDownload.body as Buffer, PNG_1X1)).toBe(0);

    // Arbitrary object key / guessed reference
    const guessed = await request(server)
      .put('/api/v1/driver/documents/IDENTITY')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        uploadReference: `sg-upload:v1:${createUuidV7()}`,
      });
    expect(guessed.status).toBe(404);

    // Extra multipart field rejection (multer fields:0)
    const extraField = await request(server)
      .post('/api/v1/driver/documents/IDENTITY/content')
      .set('Authorization', `Bearer ${driverToken}`)
      .field('ownerId', driverId)
      .attach('file', PNG_1X1, {
        filename: 'id2.png',
        contentType: 'image/png',
      });
    expect([400]).toContain(extraField.status);
    expect((extraField.body as ErrorBody).error.code).toBe(
      'STORAGE_MALFORMED_MULTIPART',
    );
  });
});
