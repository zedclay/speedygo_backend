import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createUuidV7 } from '../src/common/utils/uuid-v7';
import { PrismaService } from '../src/infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { PermissionService } from '../src/modules/authorization/permission.service';
import { AdminAuditService } from '../src/modules/admin/application/admin-audit.service';
import { adminAuditFailed } from '../src/modules/admin/domain/admin.errors';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../src/modules/admin/domain/admin-audit-actions';
import { ADMIN_PERMISSIONS } from '../src/modules/admin/domain/admin-permissions';
import { PLATFORM_SETTING_KEYS } from '../src/modules/settings/domain/settings.registry';
import { SETTINGS_ERROR_CODES } from '../src/modules/settings/domain/settings.errors';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';

type TokenBody = { accessToken: string };
type AuthMeBody = { account: { id: string; phone: string } };
type ErrorBody = { error: { code: string; message: string } };
type SettingBody = {
  key: string;
  value: string | boolean | number;
  source: string;
  updatedAt: string | null;
};

describe('Settings Foundation (e2e)', () => {
  jest.setTimeout(180_000);

  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let permissions: PermissionService;
  const phones: string[] = [];

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

  async function deleteSettingKey(key: string): Promise<void> {
    const row = await prisma
      .getDb()
      .orm.public.PlatformSetting.where({ key: pgVarchar<128>(key) })
      .first();
    if (row) {
      const audits = await prisma
        .getDb()
        .orm.public.AuditLog.where({
          targetType: pgVarchar<64>(ADMIN_AUDIT_TARGET_TYPES.PLATFORM_SETTING),
          targetId: row.id,
        })
        .all();
      for (const a of audits) {
        await prisma.getDb().orm.public.AuditLog.where({ id: a.id }).delete();
      }
      await prisma
        .getDb()
        .orm.public.PlatformSetting.where({ id: row.id })
        .delete();
    }
  }

  async function deleteAllAllowlistedSettings(): Promise<void> {
    for (const key of Object.values(PLATFORM_SETTING_KEYS)) {
      await deleteSettingKey(key);
    }
  }

  beforeEach(async () => {
    await deleteAllAllowlistedSettings();
  });

  afterAll(async () => {
    await deleteAllAllowlistedSettings();
    await deleteSettingKey('platform.publicAnnouncement');
    for (const phone of phones) {
      await cleanupByPhone(phone);
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
        deviceName: 'settings-foundation-e2e',
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
    roleName = `settings-${suffix}`,
  ): Promise<{ adminId: string; roleId: string }> {
    const now = pgNow();
    const roleId = createUuidV7();
    await prisma.getDb().orm.public.Role.create({
      id: roleId,
      name: pgVarchar<128>(roleName),
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
      displayName: pgVarchar<255>('Settings Admin'),
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
      const audits = await db.AuditLog.where({ adminId: admin.id }).all();
      for (const a of audits) {
        await db.AuditLog.where({ id: a.id }).delete();
      }
      const settings = await db.PlatformSetting.where({
        updatedByAdminId: admin.id,
      }).all();
      for (const s of settings) {
        await db.PlatformSetting.where({ id: s.id }).delete();
      }
      await db.AdminProfile.where({ id: admin.id }).delete();
      for (const rp of await db.RolePermission.where({ roleId }).all()) {
        await db.RolePermission.where({
          roleId: rp.roleId,
          permissionId: rp.permissionId,
        }).delete();
      }
      await db.Role.where({ id: roleId }).delete();
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

  function assertNoInternalAdminId(body: unknown): void {
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('updatedByAdminId');
  }

  it('authorized read returns exactly two allowlisted defaults; non-admin blocked; no secrets', async () => {
    const suffix = `${Date.now().toString().slice(-6)}a`;
    const civilianToken = await authenticate(`0591${suffix}`);
    const adminToken = await authenticate(`0592${suffix}`);
    const adminAccount = await authMe(adminToken);
    await seedAdminWithPermissions(adminAccount.id, `read-${suffix}`, [
      ADMIN_PERMISSIONS.SETTINGS_READ,
    ]);

    const denied = await request(app.getHttpServer())
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${civilianToken}`);
    expect(denied.status).toBe(403);

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const body = list.body as SettingBody[];
    expect(body).toHaveLength(2);
    expect(body.map((s) => s.key).sort()).toEqual(
      Object.values(PLATFORM_SETTING_KEYS).slice().sort(),
    );
    for (const item of body) {
      expect(item.source).toBe('APPLICATION_DEFAULT');
      expect(item.value).toBe('');
      expect(item).not.toHaveProperty('updatedByAdminId');
    }
    assertNoInternalAdminId(list.body);

    const serialized = JSON.stringify(list.body).toLowerCase();
    expect(serialized).not.toContain('jwt_secret');
    expect(serialized).not.toContain('database_url');
    expect(serialized).not.toContain('chargily');
    expect(serialized).not.toContain('webhook');
    expect(serialized).not.toContain('redis');
    expect(serialized).not.toContain('publicannouncement');
  });

  it('Role.name SUPER_ADMIN without settings codes is denied; settings.read then manage isolate correctly', async () => {
    const suffix = `${Date.now().toString().slice(-6)}r`;
    const emailKey = PLATFORM_SETTING_KEYS.SUPPORT_CONTACT_EMAIL;

    // Unique DB role name required; still proves name alone is non-authoritative.
    const bareToken = await authenticate(`0581${suffix}`);
    const bareAcct = await authMe(bareToken);
    await seedAdminWithPermissions(
      bareAcct.id,
      `bare-${suffix}`,
      [ADMIN_PERMISSIONS.MERCHANTS_READ],
      `SUPER_ADMIN-${suffix}`,
    );

    for (const path of [
      '/api/v1/admin/settings',
      `/api/v1/admin/settings/${encodeURIComponent(emailKey)}`,
    ]) {
      const getDenied = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${bareToken}`);
      expect(getDenied.status).toBe(403);
    }
    const putDenied = await request(app.getHttpServer())
      .put(`/api/v1/admin/settings/${encodeURIComponent(emailKey)}`)
      .set('Authorization', `Bearer ${bareToken}`)
      .send({ value: 'nobody@speedygo.dz' });
    expect(putDenied.status).toBe(403);
    expect(
      await prisma
        .getDb()
        .orm.public.PlatformSetting.where({ key: pgVarchar<128>(emailKey) })
        .first(),
    ).toBeNull();

    const readToken = await authenticate(`0582${suffix}`);
    const readAcct = await authMe(readToken);
    await seedAdminWithPermissions(readAcct.id, `ro-${suffix}`, [
      ADMIN_PERMISSIONS.SETTINGS_READ,
    ]);
    const listOk = await request(app.getHttpServer())
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${readToken}`);
    expect(listOk.status).toBe(200);
    expect((listOk.body as SettingBody[]).length).toBe(2);
    const getOk = await request(app.getHttpServer())
      .get(`/api/v1/admin/settings/${encodeURIComponent(emailKey)}`)
      .set('Authorization', `Bearer ${readToken}`);
    expect(getOk.status).toBe(200);
    const mutateBlocked = await request(app.getHttpServer())
      .put(`/api/v1/admin/settings/${encodeURIComponent(emailKey)}`)
      .set('Authorization', `Bearer ${readToken}`)
      .send({ value: 'ops@speedygo.dz' });
    expect(mutateBlocked.status).toBe(403);

    const manageToken = await authenticate(`0583${suffix}`);
    const manageAcct = await authMe(manageToken);
    const manageAdmin = await seedAdminWithPermissions(
      manageAcct.id,
      `rw-${suffix}`,
      [ADMIN_PERMISSIONS.SETTINGS_READ, ADMIN_PERMISSIONS.SETTINGS_MANAGE],
    );
    const updated = await request(app.getHttpServer())
      .put(`/api/v1/admin/settings/${encodeURIComponent(emailKey)}`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ value: 'support@speedygo.dz' });
    expect(updated.status).toBe(200);
    const updatedBody = updated.body as SettingBody;
    expect(updatedBody.value).toBe('support@speedygo.dz');
    expect(updatedBody).not.toHaveProperty('updatedByAdminId');
    assertNoInternalAdminId(updated.body);

    const row = await prisma
      .getDb()
      .orm.public.PlatformSetting.where({ key: pgVarchar<128>(emailKey) })
      .first();
    expect(row?.updatedByAdminId).toBe(manageAdmin.adminId);
  });

  it('settings.manage updates + audits; actor spoof fields rejected', async () => {
    const suffix = `${Date.now().toString().slice(-6)}b`;
    const manageToken = await authenticate(`0594${suffix}`);
    const spoofToken = await authenticate(`0595${suffix}`);
    const manageAcct = await authMe(manageToken);
    const spoofAcct = await authMe(spoofToken);
    const manageAdmin = await seedAdminWithPermissions(
      manageAcct.id,
      `rw-${suffix}`,
      [ADMIN_PERMISSIONS.SETTINGS_READ, ADMIN_PERMISSIONS.SETTINGS_MANAGE],
    );
    const spoofAdmin = await seedAdminWithPermissions(
      spoofAcct.id,
      `sp-${suffix}`,
      [ADMIN_PERMISSIONS.SETTINGS_READ, ADMIN_PERMISSIONS.SETTINGS_MANAGE],
      `SUPER_ADMIN-cfg-${suffix}`,
    );

    const key = PLATFORM_SETTING_KEYS.SUPPORT_CONTACT_EMAIL;

    const spoofBody = await request(app.getHttpServer())
      .put(`/api/v1/admin/settings/${encodeURIComponent(key)}`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({
        value: 'support@speedygo.dz',
        adminId: spoofAdmin.adminId,
        updatedByAdminId: spoofAdmin.adminId,
      });
    expect(spoofBody.status).toBe(400);

    const ok = await request(app.getHttpServer())
      .put(`/api/v1/admin/settings/${encodeURIComponent(key)}`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ value: 'support@speedygo.dz' });
    expect(ok.status).toBe(200);
    expect((ok.body as SettingBody).source).toBe('DATABASE');
    expect(ok.body).not.toHaveProperty('updatedByAdminId');

    const row = await prisma
      .getDb()
      .orm.public.PlatformSetting.where({ key: pgVarchar<128>(key) })
      .first();
    expect(row?.updatedByAdminId).toBe(manageAdmin.adminId);

    const audit = await prisma
      .getDb()
      .orm.public.AuditLog.where({
        adminId: manageAdmin.adminId,
        action: pgVarchar<128>(
          ADMIN_AUDIT_ACTIONS.SETTINGS_UPDATE_SUPPORT_CONTACT_EMAIL,
        ),
      })
      .first();
    expect(audit).toBeTruthy();
    expect(audit?.targetType).toBe(ADMIN_AUDIT_TARGET_TYPES.PLATFORM_SETTING);
    expect(audit?.targetId).toBe(row?.id);
  });

  it('rejects announcement and domain/secret keys; invalid values leave row unchanged', async () => {
    const suffix = `${Date.now().toString().slice(-6)}c`;
    const token = await authenticate(`0596${suffix}`);
    const acct = await authMe(token);
    await seedAdminWithPermissions(acct.id, `rej-${suffix}`, [
      ADMIN_PERMISSIONS.SETTINGS_READ,
      ADMIN_PERMISSIONS.SETTINGS_MANAGE,
    ]);

    // Orphan former announcement row must remain non-API (unknown allowlist).
    const orphanId = createUuidV7();
    const adminForOrphan = await prisma
      .getDb()
      .orm.public.AdminProfile.where({ accountId: acct.id })
      .first();
    await prisma.getDb().orm.public.PlatformSetting.create({
      id: orphanId,
      key: pgVarchar<128>('platform.publicAnnouncement'),
      valueJson: { value: 'should-not-surface' },
      updatedByAdminId: adminForOrphan!.id,
      updatedAt: pgNow(),
    });

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect((list.body as SettingBody[]).map((s) => s.key)).not.toContain(
      'platform.publicAnnouncement',
    );

    for (const badKey of [
      'platform.publicAnnouncement',
      'platform.publicAnnouncement.enabled',
      'platform.announcement',
      'commission.rate',
      'payment.secret',
      'jwt.secret',
      'arbitrary.foo',
      'cod.enabled',
      'refund.maxPercent',
    ]) {
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/admin/settings/${encodeURIComponent(badKey)}`)
        .set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(404);
      expect((getRes.body as ErrorBody).error.code).toBe(
        SETTINGS_ERROR_CODES.SETTING_NOT_SUPPORTED,
      );

      const putRes = await request(app.getHttpServer())
        .put(`/api/v1/admin/settings/${encodeURIComponent(badKey)}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ value: 'x' });
      expect(putRes.status).toBe(404);
      expect((putRes.body as ErrorBody).error.code).toBe(
        SETTINGS_ERROR_CODES.SETTING_NOT_SUPPORTED,
      );
    }

    const orphan = await prisma
      .getDb()
      .orm.public.PlatformSetting.where({ id: orphanId })
      .first();
    expect(orphan?.valueJson).toEqual({ value: 'should-not-surface' });

    const key = PLATFORM_SETTING_KEYS.SUPPORT_CONTACT_PHONE;
    await request(app.getHttpServer())
      .put(`/api/v1/admin/settings/${encodeURIComponent(key)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ value: '+213555000111' });
    const before = await prisma
      .getDb()
      .orm.public.PlatformSetting.where({ key: pgVarchar<128>(key) })
      .first();
    const invalid = await request(app.getHttpServer())
      .put(`/api/v1/admin/settings/${encodeURIComponent(key)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ value: '0555000111' });
    expect(invalid.status).toBe(400);
    expect((invalid.body as ErrorBody).error.code).toBe(
      SETTINGS_ERROR_CODES.SETTING_INVALID_VALUE,
    );
    const after = await prisma
      .getDb()
      .orm.public.PlatformSetting.where({ key: pgVarchar<128>(key) })
      .first();
    expect(after?.valueJson).toEqual(before?.valueJson);
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it('audit failure rolls back setting mutation', async () => {
    const suffix = `${Date.now().toString().slice(-6)}d`;
    const token = await authenticate(`0597${suffix}`);
    const acct = await authMe(token);
    await seedAdminWithPermissions(acct.id, `aud-${suffix}`, [
      ADMIN_PERMISSIONS.SETTINGS_READ,
      ADMIN_PERMISSIONS.SETTINGS_MANAGE,
    ]);
    const key = PLATFORM_SETTING_KEYS.SUPPORT_CONTACT_PHONE;

    const audit = app.get(AdminAuditService);
    const spy = jest
      .spyOn(audit, 'recordInTx')
      .mockRejectedValueOnce(adminAuditFailed());
    try {
      const failed = await request(app.getHttpServer())
        .put(`/api/v1/admin/settings/${encodeURIComponent(key)}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ value: '+213555000111' });
      expect(failed.status).toBe(500);
      expect((failed.body as ErrorBody).error.code).toBe('ADMIN_AUDIT_FAILED');
      const row = await prisma
        .getDb()
        .orm.public.PlatformSetting.where({ key: pgVarchar<128>(key) })
        .first();
      expect(row).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('idempotent same-value update does not create audit; concurrency last-write wins', async () => {
    const suffix = `${Date.now().toString().slice(-6)}e`;
    const aToken = await authenticate(`0598${suffix}`);
    const bToken = await authenticate(`0599${suffix}`);
    const aAcct = await authMe(aToken);
    const bAcct = await authMe(bToken);
    const aAdmin = await seedAdminWithPermissions(aAcct.id, `ca-${suffix}`, [
      ADMIN_PERMISSIONS.SETTINGS_READ,
      ADMIN_PERMISSIONS.SETTINGS_MANAGE,
    ]);
    await seedAdminWithPermissions(bAcct.id, `cb-${suffix}`, [
      ADMIN_PERMISSIONS.SETTINGS_READ,
      ADMIN_PERMISSIONS.SETTINGS_MANAGE,
    ]);
    const key = PLATFORM_SETTING_KEYS.SUPPORT_CONTACT_EMAIL;

    const first = await request(app.getHttpServer())
      .put(`/api/v1/admin/settings/${encodeURIComponent(key)}`)
      .set('Authorization', `Bearer ${aToken}`)
      .send({ value: 'one@speedygo.dz' });
    expect(first.status).toBe(200);

    const auditsBefore = await prisma
      .getDb()
      .orm.public.AuditLog.where({
        adminId: aAdmin.adminId,
        action: pgVarchar<128>(
          ADMIN_AUDIT_ACTIONS.SETTINGS_UPDATE_SUPPORT_CONTACT_EMAIL,
        ),
      })
      .all();
    expect(auditsBefore.length).toBe(1);

    const noop = await request(app.getHttpServer())
      .put(`/api/v1/admin/settings/${encodeURIComponent(key)}`)
      .set('Authorization', `Bearer ${aToken}`)
      .send({ value: 'one@speedygo.dz' });
    expect(noop.status).toBe(200);
    const auditsAfterNoop = await prisma
      .getDb()
      .orm.public.AuditLog.where({
        adminId: aAdmin.adminId,
        action: pgVarchar<128>(
          ADMIN_AUDIT_ACTIONS.SETTINGS_UPDATE_SUPPORT_CONTACT_EMAIL,
        ),
      })
      .all();
    expect(auditsAfterNoop.length).toBe(1);

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .put(`/api/v1/admin/settings/${encodeURIComponent(key)}`)
        .set('Authorization', `Bearer ${aToken}`)
        .send({ value: 'from-a@speedygo.dz' }),
      request(app.getHttpServer())
        .put(`/api/v1/admin/settings/${encodeURIComponent(key)}`)
        .set('Authorization', `Bearer ${bToken}`)
        .send({ value: 'from-b@speedygo.dz' }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const final = await request(app.getHttpServer())
      .get(`/api/v1/admin/settings/${encodeURIComponent(key)}`)
      .set('Authorization', `Bearer ${aToken}`);
    expect(final.status).toBe(200);
    expect(['from-a@speedygo.dz', 'from-b@speedygo.dz']).toContain(
      (final.body as SettingBody).value as string,
    );
  });

  it('settings mutation does not touch domain finance rows', async () => {
    const suffix = `${Date.now().toString().slice(-6)}f`;
    const token = await authenticate(`0580${suffix}`);
    const acct = await authMe(token);
    await seedAdminWithPermissions(acct.id, `dom-${suffix}`, [
      ADMIN_PERMISSIONS.SETTINGS_READ,
      ADMIN_PERMISSIONS.SETTINGS_MANAGE,
    ]);

    const db = prisma.getDb().orm.public;
    const commissionCount = (await db.MerchantCommissionRule.all()).length;
    const pricingCount = (await db.DeliveryPricingRule.all()).length;
    const promoCount = (await db.Promotion.all()).length;
    const paymentCount = (await db.Payment.all()).length;
    const refundCount = (await db.Refund.all()).length;
    const settlementCount = (await db.MerchantSettlement.all()).length;
    const earningCount = (await db.DriverEarning.all()).length;
    const ledgerCount = (await db.FinancialLedgerEntry.all()).length;

    const key = PLATFORM_SETTING_KEYS.SUPPORT_CONTACT_EMAIL;
    await request(app.getHttpServer())
      .put(`/api/v1/admin/settings/${encodeURIComponent(key)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 'immutable-check@speedygo.dz' });

    expect((await db.MerchantCommissionRule.all()).length).toBe(
      commissionCount,
    );
    expect((await db.DeliveryPricingRule.all()).length).toBe(pricingCount);
    expect((await db.Promotion.all()).length).toBe(promoCount);
    expect((await db.Payment.all()).length).toBe(paymentCount);
    expect((await db.Refund.all()).length).toBe(refundCount);
    expect((await db.MerchantSettlement.all()).length).toBe(settlementCount);
    expect((await db.DriverEarning.all()).length).toBe(earningCount);
    expect((await db.FinancialLedgerEntry.all()).length).toBe(ledgerCount);
  });
});
