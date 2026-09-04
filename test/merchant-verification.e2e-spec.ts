import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';
import { configureApp } from '../src/app.setup';
import { createUuidV7 } from '../src/common/utils/uuid-v7';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { PrismaService } from '../src/infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { MerchantReviewService } from '../src/modules/merchants/application/merchant-review.service';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type MembershipBody = {
  merchantId: string;
  verificationReady: boolean;
  verificationSubmitted: boolean;
  approved: boolean;
  operationalReady: boolean;
  merchant: {
    status: string;
    verifiedAt: string | null;
    name: string;
  };
  documents: Array<{ type: string; status: string; expiryDate: string | null }>;
};

describe('Merchant verification foundation (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let review: MerchantReviewService;

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
    review = app.get(MerchantReviewService);
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
        deviceName: 'merchant-verification-e2e',
      });
    expect(verified.status).toBe(200);
    return (verified.body as TokenBody).accessToken;
  }

  async function cleanupByPhone(phoneE164: string): Promise<void> {
    const account = await prisma
      .getDb()
      .orm.public.Account.where({ phone: phoneE164 })
      .first();
    if (!account) {
      return;
    }
    const members = await prisma
      .getDb()
      .orm.public.MerchantMember.where({ accountId: account.id })
      .all();
    for (const member of members) {
      const docs = await prisma
        .getDb()
        .orm.public.MerchantDocument.where({ merchantId: member.merchantId })
        .all();
      for (const doc of docs) {
        await prisma
          .getDb()
          .orm.public.MerchantDocument.where({ id: doc.id })
          .delete();
      }
      const branches = await prisma
        .getDb()
        .orm.public.MerchantBranch.where({ merchantId: member.merchantId })
        .all();
      for (const branch of branches) {
        await prisma
          .getDb()
          .orm.public.MerchantBranch.where({ id: branch.id })
          .delete();
      }
      await prisma
        .getDb()
        .orm.public.MerchantMember.where({ id: member.id })
        .delete();
      await prisma
        .getDb()
        .orm.public.Merchant.where({ id: member.merchantId })
        .delete();
    }
    const admin = await prisma
      .getDb()
      .orm.public.AdminProfile.where({ accountId: account.id })
      .first();
    if (admin) {
      await prisma
        .getDb()
        .orm.public.AdminProfile.where({ id: admin.id })
        .delete();
      await prisma.getDb().orm.public.Role.where({ id: admin.roleId }).delete();
    }
    const sessions = await prisma
      .getDb()
      .orm.public.Session.where({ accountId: account.id })
      .all();
    for (const session of sessions) {
      await prisma
        .getDb()
        .orm.public.Session.where({ id: session.id })
        .delete();
    }
    const devices = await prisma
      .getDb()
      .orm.public.Device.where({ accountId: account.id })
      .all();
    for (const device of devices) {
      await prisma.getDb().orm.public.Device.where({ id: device.id }).delete();
    }
    await deleteAccountNotificationArtifacts(prisma, account.id);
    await prisma.getDb().orm.public.Account.where({ id: account.id }).delete();
  }

  async function createAdmin(
    accountId: string,
    suffix: string,
  ): Promise<string> {
    const now = pgNow();
    const roleId = createUuidV7();
    await prisma.getDb().orm.public.Role.create({
      id: roleId,
      name: pgVarchar<128>(`mv-e2e-${suffix}`),
      description: null,
      active: true,
    });
    const adminId = createUuidV7();
    await prisma.getDb().orm.public.AdminProfile.create({
      id: adminId,
      accountId,
      roleId,
      displayName: pgVarchar<255>('Verification Admin'),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    return adminId;
  }

  it('registers evidence, submits, approves/rejects, and protects privacy', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      owner: `0581${suffix}`,
      other: `0582${suffix}`,
      admin: `0583${suffix}`,
    };
    const e164: string[] = [];
    try {
      const ownerToken = await authenticate(phones.owner);
      const otherToken = await authenticate(phones.other);
      const adminToken = await authenticate(phones.admin);
      for (const token of [ownerToken, otherToken, adminToken]) {
        const me = await request(server)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${token}`);
        e164.push((me.body as { account: { phone: string } }).account.phone);
      }
      const adminAccountId = (
        await request(server)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${adminToken}`)
      ).body as { account: { id: string } };
      const adminId = await createAdmin(adminAccountId.account.id, suffix);

      const injected = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Verify Cafe',
          status: 'ACTIVE',
          verifiedAt: '2026-01-01T00:00:00.000Z',
        });
      expect(injected.status).toBe(400);

      const created = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Verify Cafe' });
      expect(created.status).toBe(201);
      const membership = created.body as MembershipBody;
      expect(membership.merchant.status).toBe('PENDING_REVIEW');
      expect(membership.merchant.verifiedAt).toBeNull();
      expect(membership.verificationReady).toBe(false);
      expect(membership.verificationSubmitted).toBe(false);
      const merchantId = membership.merchantId;

      const incomplete = await request(server)
        .post(`/api/v1/merchant/${merchantId}/verification/submit`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});
      expect(incomplete.status).toBe(409);
      expect((incomplete.body as ErrorBody).error.code).toBe(
        'MERCHANT_VERIFICATION_NOT_READY',
      );

      const identityInjected = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/verification/documents/BUSINESS_IDENTITY`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ status: 'ACTIVE', fileUrl: 'https://evil.example/x' });
      expect(identityInjected.status).toBe(400);

      const identity = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/verification/documents/BUSINESS_IDENTITY`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});
      expect(identity.status).toBe(200);
      expect(
        (identity.body as MembershipBody).documents.some(
          (doc) => doc.type === 'BUSINESS_IDENTITY' && doc.status === 'PENDING',
        ),
      ).toBe(true);

      const registration = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/verification/documents/BUSINESS_REGISTRATION`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ expiryDate: '2099-01-01' });
      expect(registration.status).toBe(200);
      expect((registration.body as MembershipBody).verificationReady).toBe(
        true,
      );
      expect((registration.body as MembershipBody).verificationSubmitted).toBe(
        false,
      );

      const approveBeforeSubmit = review.approve({ merchantId, adminId });
      await expect(approveBeforeSubmit).rejects.toMatchObject({
        code: 'MERCHANT_VERIFICATION_INVALID_STATE',
      });

      const foreign = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/verification/documents/BUSINESS_IDENTITY`,
        )
        .set('Authorization', `Bearer ${otherToken}`)
        .send({});
      expect(foreign.status).toBe(404);

      const submitted = await request(server)
        .post(`/api/v1/merchant/${merchantId}/verification/submit`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});
      expect(submitted.status).toBe(200);
      const submittedBody = submitted.body as MembershipBody;
      expect(submittedBody.verificationSubmitted).toBe(true);
      expect(submittedBody.merchant.status).toBe('PENDING_REVIEW');
      expect(submittedBody.approved).toBe(false);

      const lockedName = await request(server)
        .patch(`/api/v1/merchant/${merchantId}/profile`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Hacked Name' });
      expect(lockedName.status).toBe(409);

      const lockedDoc = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/verification/documents/BUSINESS_IDENTITY`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});
      expect(lockedDoc.status).toBe(409);

      const approved = await review.approve({ merchantId, adminId });
      expect(approved.status).toBe('ACTIVE');
      expect(approved.verifiedAt).not.toBeNull();

      const meAfter = await request(server)
        .get('/api/v1/merchant/me')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(meAfter.status).toBe(200);
      const activeMembership = (
        meAfter.body as { memberships: MembershipBody[] }
      ).memberships[0];
      expect(activeMembership.merchant.status).toBe('ACTIVE');
      expect(activeMembership.approved).toBe(true);

      const activeName = await request(server)
        .patch(`/api/v1/merchant/${merchantId}/profile`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'New Legal Name' });
      expect(activeName.status).toBe(409);

      const activeDoc = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/verification/documents/SUPPORTING_DOCUMENT`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});
      expect(activeDoc.status).toBe(409);

      const merchantB = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Second Merchant' });
      expect(merchantB.status).toBe(201);
      const merchantBId = (merchantB.body as MembershipBody).merchantId;

      await request(server)
        .put(
          `/api/v1/merchant/${merchantBId}/verification/documents/BUSINESS_IDENTITY`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});
      await request(server)
        .put(
          `/api/v1/merchant/${merchantBId}/verification/documents/BUSINESS_REGISTRATION`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ expiryDate: '2099-01-01' });
      await request(server)
        .post(`/api/v1/merchant/${merchantBId}/verification/submit`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});
      await review.reject({
        merchantId: merchantBId,
        adminId,
      });
      const meMulti = await request(server)
        .get('/api/v1/merchant/me')
        .set('Authorization', `Bearer ${ownerToken}`);
      const multi = (meMulti.body as { memberships: MembershipBody[] })
        .memberships;
      const a = multi.find((row) => row.merchantId === merchantId)!;
      const b = multi.find((row) => row.merchantId === merchantBId)!;
      expect(a.merchant.status).toBe('ACTIVE');
      expect(b.merchant.status).toBe('REJECTED');

      const stillAuth = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(stillAuth.status).toBe(200);

      const packageRead = await request(server)
        .get(`/api/v1/merchant/${merchantId}/verification`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(packageRead.status).toBe(200);
      expect(
        JSON.stringify(packageRead.body).includes(
          'sg-object:merchant-document',
        ),
      ).toBe(false);

      const concurrentMerchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ name: 'Race Cafe' });
      const raceId = (concurrentMerchant.body as MembershipBody).merchantId;
      await request(server)
        .put(
          `/api/v1/merchant/${raceId}/verification/documents/BUSINESS_IDENTITY`,
        )
        .set('Authorization', `Bearer ${otherToken}`)
        .send({});
      await request(server)
        .put(
          `/api/v1/merchant/${raceId}/verification/documents/BUSINESS_REGISTRATION`,
        )
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ expiryDate: '2099-01-01' });
      await request(server)
        .post(`/api/v1/merchant/${raceId}/verification/submit`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({});
      const race = await Promise.allSettled([
        review.approve({ merchantId: raceId, adminId }),
        review.reject({ merchantId: raceId, adminId }),
      ]);
      expect(race.filter((row) => row.status === 'fulfilled').length).toBe(1);
      expect(race.filter((row) => row.status === 'rejected').length).toBe(1);
      const raceRow = await prisma
        .getDb()
        .orm.public.Merchant.where({ id: raceId })
        .first();
      expect(['ACTIVE', 'REJECTED']).toContain(raceRow!.status);

      await review.suspend({ merchantId, adminId });
      await expect(
        review.approve({ merchantId, adminId }),
      ).rejects.toMatchObject({
        code: 'MERCHANT_VERIFICATION_INVALID_STATE',
      });
    } finally {
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });
});
