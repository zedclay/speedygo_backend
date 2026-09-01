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

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type AuthMeBody = { account: { id: string; phone: string } };
type MembershipBody = {
  merchantId: string;
  role: string;
  profileComplete: boolean;
  hasBranch: boolean;
  branchReady: boolean;
  approved: boolean;
  operationalReady: boolean;
  merchant: {
    name: string;
    status: string;
    publicReference: string;
    verifiedAt: string | null;
  };
};
type MeBody = {
  merchantMembershipExists: boolean;
  memberships: MembershipBody[];
};
type BranchBody = {
  id: string;
  name: string;
  phone: string;
  addressText: string;
  isDefault?: boolean;
  operationalStatus: string;
};

describe('Merchant foundation (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;

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
        deviceName: 'merchant-e2e',
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

  async function cleanupByPhone(phoneE164: string) {
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
    const merchantIds = [...new Set(members.map((row) => row.merchantId))];
    for (const merchantId of merchantIds) {
      const branches = await prisma
        .getDb()
        .orm.public.MerchantBranch.where({ merchantId })
        .all();
      for (const branch of branches) {
        await prisma
          .getDb()
          .orm.public.MerchantBranch.where({ id: branch.id })
          .delete();
      }
      const docs = await prisma
        .getDb()
        .orm.public.MerchantDocument.where({ merchantId })
        .all();
      for (const doc of docs) {
        await prisma
          .getDb()
          .orm.public.MerchantDocument.where({ id: doc.id })
          .delete();
      }
      const remainingMembers = await prisma
        .getDb()
        .orm.public.MerchantMember.where({ merchantId })
        .all();
      for (const member of remainingMembers) {
        await prisma
          .getDb()
          .orm.public.MerchantMember.where({ id: member.id })
          .delete();
      }
      await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantId })
        .delete();
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
    await prisma.getDb().orm.public.Account.where({ id: account.id }).delete();
  }

  it('creates PENDING_REVIEW OWNER, readiness, approval fixture, and IDOR isolation', async () => {
    const server = app.getHttpServer();
    const phoneA = `0561${Date.now().toString().slice(-6)}`;
    const phoneB = `0562${Date.now().toString().slice(-6)}`;
    let e164A: string | null = null;
    let e164B: string | null = null;

    try {
      const tokenA = await authenticate(phoneA);
      const tokenB = await authenticate(phoneB);
      e164A = (await authMe(tokenA)).phone;
      e164B = (await authMe(tokenB)).phone;

      const absent = await request(server)
        .get('/api/v1/merchant/me')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(absent.status).toBe(200);
      expect((absent.body as MeBody).merchantMembershipExists).toBe(false);
      expect((absent.body as MeBody).memberships).toEqual([]);

      const rejected = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Cafe A', status: 'ACTIVE' });
      expect(rejected.status).toBe(400);

      const created = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: '  Cafe A  ' });
      expect(created.status).toBe(201);
      const membership = created.body as MembershipBody;
      expect(membership.merchant.name).toBe('Cafe A');
      expect(membership.role).toBe('OWNER');
      expect(membership.merchant.status).toBe('PENDING_REVIEW');
      expect(membership.merchant.verifiedAt).toBeNull();
      expect(membership.merchant.publicReference).toMatch(/^sgm_/);
      expect(membership.hasBranch).toBe(false);
      expect(membership.operationalReady).toBe(false);
      const merchantId = membership.merchantId;

      const me = await request(server)
        .get('/api/v1/merchant/me')
        .set('Authorization', `Bearer ${tokenA}`);
      expect((me.body as MeBody).merchantMembershipExists).toBe(true);
      expect((me.body as MeBody).memberships[0]?.merchantId).toBe(merchantId);

      const patched = await request(server)
        .patch(`/api/v1/merchant/${merchantId}/profile`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Cafe A Updated' });
      expect(patched.status).toBe(200);
      expect((patched.body as MembershipBody).merchant.name).toBe(
        'Cafe A Updated',
      );

      const branchA = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Branch A',
          phone: '0550123456',
          addressText: 'Street A',
          latitude: 36.75,
          longitude: 3.05,
        });
      expect(branchA.status).toBe(201);
      const createdA = branchA.body as BranchBody;
      expect(createdA.phone).toBe('+213550123456');
      expect(createdA.operationalStatus).toBe('ACTIVE');
      expect(createdA).not.toHaveProperty('isDefault');

      const pendingMe = await request(server)
        .get('/api/v1/merchant/me')
        .set('Authorization', `Bearer ${tokenA}`);
      const pendingMembership = (pendingMe.body as MeBody).memberships[0];
      expect(pendingMembership?.hasBranch).toBe(true);
      expect(pendingMembership?.branchReady).toBe(true);
      expect(pendingMembership?.approved).toBe(false);
      expect(pendingMembership?.operationalReady).toBe(false);

      await approveMerchant(merchantId);

      const approvedMe = await request(server)
        .get('/api/v1/merchant/me')
        .set('Authorization', `Bearer ${tokenA}`);
      const approvedMembership = (approvedMe.body as MeBody).memberships[0];
      expect(approvedMembership?.merchant.status).toBe('ACTIVE');
      expect(approvedMembership?.merchant.verifiedAt).toBeTruthy();
      expect(approvedMembership?.approved).toBe(true);
      expect(approvedMembership?.operationalReady).toBe(true);

      const lockedName = await request(server)
        .patch(`/api/v1/merchant/${merchantId}/profile`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Should Fail' });
      expect(lockedName.status).toBe(409);
      expect((lockedName.body as ErrorBody).error.code).toBe(
        'MERCHANT_STATUS_RESTRICTED',
      );

      const lastBranch = await request(server)
        .delete(`/api/v1/merchant/${merchantId}/branches/${createdA.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(lastBranch.status).toBe(409);
      expect((lastBranch.body as ErrorBody).error.code).toBe(
        'MERCHANT_LAST_BRANCH_REQUIRED',
      );

      const bMe = await request(server)
        .get('/api/v1/merchant/me')
        .set('Authorization', `Bearer ${tokenB}`);
      expect((bMe.body as MeBody).merchantMembershipExists).toBe(false);

      const stealProfile = await request(server)
        .patch(`/api/v1/merchant/${merchantId}/profile`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Hijack' });
      expect(stealProfile.status).toBe(404);
      expect((stealProfile.body as ErrorBody).error.code).toBe(
        'MERCHANT_NOT_FOUND',
      );

      const stealBranch = await request(server)
        .patch(`/api/v1/merchant/${merchantId}/branches/${createdA.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Stolen' });
      expect(stealBranch.status).toBe(404);

      const stealDelete = await request(server)
        .delete(`/api/v1/merchant/${merchantId}/branches/${createdA.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(stealDelete.status).toBe(404);

      const unauth = await request(server).get('/api/v1/merchant/me');
      expect(unauth.status).toBe(401);
    } finally {
      if (e164A) {
        await cleanupByPhone(e164A);
      }
      if (e164B) {
        await cleanupByPhone(e164B);
      }
    }
  });

  it('enforces OWNER MANAGER STAFF restrictions without an Admin approval API', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      owner: `0571${suffix}`,
      manager: `0572${suffix}`,
      staff: `0573${suffix}`,
    };
    const e164: string[] = [];
    try {
      const ownerToken = await authenticate(phones.owner);
      const managerToken = await authenticate(phones.manager);
      const staffToken = await authenticate(phones.staff);
      const owner = await authMe(ownerToken);
      const manager = await authMe(managerToken);
      const staff = await authMe(staffToken);
      e164.push(owner.phone, manager.phone, staff.phone);

      const created = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Role Cafe' });
      expect(created.status).toBe(201);
      const merchantId = (created.body as MembershipBody).merchantId;
      await seedMembership(merchantId, manager.id, 'MANAGER');
      await seedMembership(merchantId, staff.id, 'STAFF');

      const managerProfile = await request(server)
        .patch(`/api/v1/merchant/${merchantId}/profile`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Manager Rename' });
      expect(managerProfile.status).toBe(403);
      expect((managerProfile.body as ErrorBody).error.code).toBe(
        'MERCHANT_ROLE_FORBIDDEN',
      );

      const staffProfile = await request(server)
        .patch(`/api/v1/merchant/${merchantId}/profile`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ name: 'Staff Rename' });
      expect(staffProfile.status).toBe(403);

      const managerBranch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          name: 'Mgr Branch',
          phone: '0550123456',
          addressText: 'Street M',
          latitude: 36.75,
          longitude: 3.05,
        });
      expect(managerBranch.status).toBe(201);

      const staffBranch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Staff Branch',
          phone: '0550123457',
          addressText: 'Street S',
          latitude: 36.76,
          longitude: 3.06,
        });
      expect(staffBranch.status).toBe(403);
      expect((staffBranch.body as ErrorBody).error.code).toBe(
        'MERCHANT_ROLE_FORBIDDEN',
      );

      const staffList = await request(server)
        .get(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${staffToken}`);
      expect(staffList.status).toBe(200);
    } finally {
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });

  it('allows concurrent merchant creates for the same account', async () => {
    const server = app.getHttpServer();
    const phone = `0563${Date.now().toString().slice(-6)}`;
    let e164: string | null = null;
    try {
      const token = await authenticate(phone);
      e164 = (await authMe(token)).phone;

      const [first, second] = await Promise.all([
        request(server)
          .post('/api/v1/merchant/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ name: 'One' }),
        request(server)
          .post('/api/v1/merchant/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ name: 'Two' }),
      ]);
      expect([first.status, second.status].sort()).toEqual([201, 201]);
      const me = await request(server)
        .get('/api/v1/merchant/me')
        .set('Authorization', `Bearer ${token}`);
      expect((me.body as MeBody).memberships).toHaveLength(2);
      expect(
        (me.body as MeBody).memberships.every(
          (row) =>
            row.role === 'OWNER' && row.merchant.status === 'PENDING_REVIEW',
        ),
      ).toBe(true);
    } finally {
      if (e164) {
        await cleanupByPhone(e164);
      }
    }
  });

  it('cannot leave an ACTIVE Merchant with zero Branches under concurrent deletes', async () => {
    const server = app.getHttpServer();
    const phone = `0564${Date.now().toString().slice(-6)}`;
    let e164: string | null = null;
    try {
      const token = await authenticate(phone);
      e164 = (await authMe(token)).phone;
      const created = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Concurrent Cafe' });
      const merchantId = (created.body as MembershipBody).merchantId;
      const branchPayload = {
        phone: '0550123456',
        addressText: 'Street',
        latitude: 36.75,
        longitude: 3.05,
      };
      const first = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...branchPayload, name: 'One' });
      const second = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...branchPayload, name: 'Two' });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      await approveMerchant(merchantId);

      const [left, right] = await Promise.all([
        request(server)
          .delete(
            `/api/v1/merchant/${merchantId}/branches/${(first.body as BranchBody).id}`,
          )
          .set('Authorization', `Bearer ${token}`),
        request(server)
          .delete(
            `/api/v1/merchant/${merchantId}/branches/${(second.body as BranchBody).id}`,
          )
          .set('Authorization', `Bearer ${token}`),
      ]);
      const statuses = [left.status, right.status].sort();
      expect(statuses).toEqual([200, 409]);
      const conflict = left.status === 409 ? left : right;
      expect((conflict.body as ErrorBody).error.code).toBe(
        'MERCHANT_LAST_BRANCH_REQUIRED',
      );
      const listed = await request(server)
        .get(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${token}`);
      expect((listed.body as { branches: BranchBody[] }).branches).toHaveLength(
        1,
      );
    } finally {
      if (e164) {
        await cleanupByPhone(e164);
      }
    }
  });
});
