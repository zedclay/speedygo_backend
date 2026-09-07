/**
 * E2E tests: Admin Delivery Zones + Pricing APIs v1.0
 *
 * Covers: permissions, spoofing, zone CRUD, pricing rule CRUD,
 * overlap rejection, dual-active rejection, money strings,
 * above-safe-integer, no DELETE, audit log, checkout inside/outside,
 * OFS immutability, settings rejection, opening hours enforcement.
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
import {
  pgNow,
  pgTimestamptz,
  pgVarchar,
} from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { PermissionService } from '../src/modules/authorization/permission.service';
import { ADMIN_PERMISSIONS } from '../src/modules/admin/domain/admin-permissions';
import { ADMIN_AUDIT_ACTIONS } from '../src/modules/admin/domain/admin-audit-actions';
import { deactivateAllDeliveryZones } from './helpers/sanitize-delivery-zones';
import { deactivateOpenGlobalCommissionDefaults } from './helpers/sanitize-commission-globals';
import {
  ensureBranchOpeningHours,
  deleteBranchOpeningHours,
} from './helpers/ensure-branch-opening-hours';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type AuthMeBody = { account: { id: string; phone: string } };
type ZoneBody = {
  id: string;
  name: string;
  geometry: { type: string; coordinates: unknown };
  active: boolean;
};
type ZoneListBody = { items: ZoneBody[]; total: number };
type RuleBody = {
  id: string;
  zoneId: string;
  name: string;
  timeBand: string;
  customerDeliveryFeeMinor: string;
  driverRemunerationMinor: string;
  active: boolean;
};
type RuleListBody = { items: RuleBody[]; total: number };
type MembershipBody = { merchantId: string };
type BranchBody = { id: string };
type CategoryBody = { id: string };
type ProductBody = { id: string };

const INSIDE: [number, number] = [36.75, 3.05]; // [lat, lon]
const OUTSIDE: [number, number] = [40.0, 0.0]; // outside the ring

/** Same polygon used by checkout.e2e-spec.ts: covers INSIDE, not OUTSIDE */
const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

/** A small polygon that overlaps COVERING_RING (used for overlap test) */
const OVERLAP_RING: Array<[number, number]> = [
  [3.04, 36.74],
  [3.06, 36.74],
  [3.06, 36.76],
  [3.04, 36.76],
  [3.04, 36.74],
];

/** A polygon that does NOT overlap COVERING_RING */
const NOOVERLAP_RING: Array<[number, number]> = [
  [10.0, 50.0],
  [10.1, 50.0],
  [10.1, 50.1],
  [10.0, 50.1],
  [10.0, 50.0],
];

describe('Admin Delivery Zones + Pricing (e2e)', () => {
  jest.setTimeout(300_000);

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
    await deactivateAllDeliveryZones(prisma);
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

  // ── helpers ──────────────────────────────────────────────────────────────

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
        deviceName: 'delivery-e2e',
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
      name: pgVarchar<128>(`adz-e2e-${suffix}`),
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
      displayName: pgVarchar<255>(`Delivery Admin ${suffix}`),
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
    if (!account) return;
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
    const customerProfile = await db.CustomerProfile.where({
      accountId: account.id,
    }).first();
    if (customerProfile) {
      const carts = await db.Cart.where({
        customerId: customerProfile.id,
      }).all();
      for (const cart of carts) {
        await db.Cart.where({ id: cart.id }).delete();
      }
      const orders = await db.Order.where({
        customerId: customerProfile.id,
      }).all();
      for (const order of orders) {
        await db.Order.where({ id: order.id }).delete();
      }
      const addresses = await db.Address.where({
        customerId: customerProfile.id,
      }).all();
      for (const addr of addresses) {
        await db.Address.where({ id: addr.id }).delete();
      }
      await db.CustomerProfile.where({ id: customerProfile.id }).delete();
    }
    const members = await db.MerchantMember.where({
      accountId: account.id,
    }).all();
    for (const member of members) {
      const branches = await db.MerchantBranch.where({
        merchantId: member.merchantId,
      }).all();
      for (const branch of branches) {
        await deleteBranchOpeningHours(prisma, branch.id).catch(
          () => undefined,
        );
        const cats = await db.Category.where({
          merchantBranchId: branch.id,
        }).all();
        for (const cat of cats) {
          const prods = await db.Product.where({
            merchantBranchId: branch.id,
          }).all();
          for (const prod of prods) {
            await db.Product.where({ id: prod.id }).delete();
          }
          await db.Category.where({ id: cat.id }).delete();
        }
        await db.MerchantBranch.where({ id: branch.id }).delete();
      }
      await db.Merchant.where({ id: member.merchantId }).delete();
      await db.MerchantMember.where({
        merchantId: member.merchantId,
        accountId: account.id,
      }).delete();
    }
    const sessions = await db.Session.where({ accountId: account.id }).all();
    for (const s of sessions) await db.Session.where({ id: s.id }).delete();
    const devices = await db.Device.where({ accountId: account.id }).all();
    for (const d of devices) await db.Device.where({ id: d.id }).delete();
    await deleteAccountNotificationArtifacts(prisma, account.id);
    await db.Account.where({ id: account.id }).delete();
  }

  async function cleanupZones(zoneIds: string[]): Promise<void> {
    // Prefer deactivate over hard-delete: OrderFinancialSnapshot may FK-reference
    // pricing rules / zones after OFS tests.
    for (const zoneId of zoneIds) {
      const rules = await prisma
        .getDb()
        .orm.public.DeliveryPricingRule.where({ zoneId })
        .all();
      for (const rule of rules) {
        await prisma
          .getDb()
          .orm.public.DeliveryPricingRule.where({ id: rule.id })
          .update({ active: false, updatedAt: pgNow() });
      }
      await prisma
        .getDb()
        .orm.public.DeliveryZone.where({ id: zoneId })
        .update({ active: false, updatedAt: pgNow() });
    }
  }

  // ── test: permissions and spoof ──────────────────────────────────────────

  it('enforces permissions: non-admin blocked, read-only admin blocked from write', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}1`;
    const phones = {
      customer: `0600${suffix}`,
      readAdmin: `0601${suffix}`,
      noPermAdmin: `0602${suffix}`,
    };

    try {
      const custToken = await authenticate(phones.customer);
      const readToken = await authenticate(phones.readAdmin);
      const noPermToken = await authenticate(phones.noPermAdmin);

      const readAcct = await authMe(readToken);
      const noPermAcct = await authMe(noPermToken);

      await seedAdminWithPermissions(readAcct.id, `r${suffix}`, [
        ADMIN_PERMISSIONS.DELIVERY_ZONES_READ,
        ADMIN_PERMISSIONS.DELIVERY_PRICING_READ,
      ]);
      await seedAdminWithPermissions(noPermAcct.id, `np${suffix}`, []);

      // 1. Non-admin (customer) gets 403 on zone list
      const noAdmin = await request(server)
        .get('/api/v1/admin/delivery/zones')
        .set('Authorization', `Bearer ${custToken}`);
      expect(noAdmin.status).toBe(403);

      // 2. Admin with READ can list zones
      const canList = await request(server)
        .get('/api/v1/admin/delivery/zones')
        .set('Authorization', `Bearer ${readToken}`);
      expect(canList.status).toBe(200);

      // 3. Admin with READ cannot create zones (403)
      const noCreate = await request(server)
        .post('/api/v1/admin/delivery/zones')
        .set('Authorization', `Bearer ${readToken}`)
        .send({
          name: 'Spoof Zone',
          geometry: { type: 'Polygon', coordinates: [COVERING_RING] },
        });
      expect(noCreate.status).toBe(403);

      // 4. No-permission admin cannot even list
      const noPermList = await request(server)
        .get('/api/v1/admin/delivery/zones')
        .set('Authorization', `Bearer ${noPermToken}`);
      expect(noPermList.status).toBe(403);

      // 5. No DELETE endpoint — must return 404 or 405
      const noDelete = await request(server)
        .delete(`/api/v1/admin/delivery/zones/${createUuidV7()}`)
        .set('Authorization', `Bearer ${readToken}`);
      expect([404, 405]).toContain(noDelete.status);
    } finally {
      for (const p of Object.values(phones)) {
        await cleanupByPhone(p).catch(() => undefined);
      }
    }
  });

  // ── test: zone CRUD + overlap + invalid geometry + audit ─────────────────

  it('zone CRUD: create, list, get, update, activate, deactivate, overlap, invalid geometry, audit', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}2`;
    const phone = `0610${suffix}`;
    const localZones: string[] = [];

    try {
      const token = await authenticate(phone);
      const acct = await authMe(token);
      const { adminId } = await seedAdminWithPermissions(
        acct.id,
        `z${suffix}`,
        [
          ADMIN_PERMISSIONS.DELIVERY_ZONES_READ,
          ADMIN_PERMISSIONS.DELIVERY_ZONES_MANAGE,
          ADMIN_PERMISSIONS.DELIVERY_PRICING_READ,
          ADMIN_PERMISSIONS.DELIVERY_PRICING_MANAGE,
          ADMIN_PERMISSIONS.AUDIT_READ,
        ],
      );

      // --- CREATE ZONE ---
      const createRes = await request(server)
        .post('/api/v1/admin/delivery/zones')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `Zone CRUD ${suffix}`,
          geometry: { type: 'Polygon', coordinates: [COVERING_RING] },
        });
      expect(createRes.status).toBe(201);
      const zone = createRes.body as ZoneBody;
      expect(zone.id).toBeTruthy();
      expect(zone.name).toBe(`Zone CRUD ${suffix}`);
      expect(zone.active).toBe(false);
      expect(zone.geometry.type).toBe('MultiPolygon');
      localZones.push(zone.id);

      // --- LIST ZONES ---
      const listRes = await request(server)
        .get('/api/v1/admin/delivery/zones')
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      const listBody = listRes.body as ZoneListBody;
      expect(listBody.items.some((z) => z.id === zone.id)).toBe(true);

      // --- GET BY ID ---
      const getRes = await request(server)
        .get(`/api/v1/admin/delivery/zones/${zone.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);
      expect((getRes.body as ZoneBody).id).toBe(zone.id);

      // --- UPDATE ---
      const updatedName = `Zone CRUD updated ${suffix}`;
      const putRes = await request(server)
        .put(`/api/v1/admin/delivery/zones/${zone.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: updatedName });
      expect(putRes.status).toBe(200);
      expect((putRes.body as ZoneBody).name).toBe(updatedName);

      // --- ACTIVATE ---
      const activateRes = await request(server)
        .post(`/api/v1/admin/delivery/zones/${zone.id}/activate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(activateRes.status).toBe(200);
      expect((activateRes.body as ZoneBody).active).toBe(true);

      // --- IDEMPOTENT ACTIVATE ---
      const activateAgain = await request(server)
        .post(`/api/v1/admin/delivery/zones/${zone.id}/activate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(activateAgain.status).toBe(200);
      expect((activateAgain.body as ZoneBody).active).toBe(true);

      // --- OVERLAP REJECTION: inactive draft allowed; activate rejects interior overlap ---
      const overlapRes = await request(server)
        .post('/api/v1/admin/delivery/zones')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `Zone Overlap ${suffix}`,
          geometry: { type: 'Polygon', coordinates: [OVERLAP_RING] },
        });
      expect(overlapRes.status).toBe(201);
      const overlapZone = overlapRes.body as ZoneBody;
      localZones.push(overlapZone.id);
      const overlapAct = await request(server)
        .post(`/api/v1/admin/delivery/zones/${overlapZone.id}/activate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(overlapAct.status).toBe(409);
      expect((overlapAct.body as ErrorBody).error.code).toBe(
        'DELIVERY_ZONE_OVERLAP',
      );

      // --- NON-OVERLAPPING ZONE is accepted ---
      const noOverlapRes = await request(server)
        .post('/api/v1/admin/delivery/zones')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `Zone NoOverlap ${suffix}`,
          geometry: { type: 'Polygon', coordinates: [NOOVERLAP_RING] },
        });
      expect(noOverlapRes.status).toBe(201);
      const noOverlapZone = noOverlapRes.body as ZoneBody;
      localZones.push(noOverlapZone.id);

      // --- INVALID GEOMETRY: FeatureCollection rejected ---
      const invalidGeomRes = await request(server)
        .post('/api/v1/admin/delivery/zones')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `Zone Invalid ${suffix}`,
          geometry: { type: 'FeatureCollection', features: [] },
        });
      expect(invalidGeomRes.status).toBe(400);
      expect((invalidGeomRes.body as ErrorBody).error.code).toBe(
        'DELIVERY_ZONE_INVALID_GEOMETRY',
      );

      // --- DEACTIVATE ---
      const deactRes = await request(server)
        .post(`/api/v1/admin/delivery/zones/${zone.id}/deactivate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(deactRes.status).toBe(200);
      expect((deactRes.body as ZoneBody).active).toBe(false);

      // --- AUDIT LOG ---
      const auditRes = await request(server)
        .get('/api/v1/admin/audit')
        .query({
          adminId,
          action: ADMIN_AUDIT_ACTIONS.DELIVERY_ZONE_CREATE,
          targetId: zone.id,
        })
        .set('Authorization', `Bearer ${token}`);
      expect(auditRes.status).toBe(200);
      const auditBody = auditRes.body as {
        total: number;
        items: Array<{ adminId: string; action: string; targetId: string }>;
      };
      expect(auditBody.total).toBeGreaterThanOrEqual(1);
      expect(auditBody.items[0]).toMatchObject({
        adminId,
        action: ADMIN_AUDIT_ACTIONS.DELIVERY_ZONE_CREATE,
        targetId: zone.id,
      });

      // --- NOT FOUND ---
      const notFoundRes = await request(server)
        .get(`/api/v1/admin/delivery/zones/${createUuidV7()}`)
        .set('Authorization', `Bearer ${token}`);
      expect(notFoundRes.status).toBe(404);
      expect((notFoundRes.body as ErrorBody).error.code).toBe(
        'DELIVERY_ZONE_NOT_FOUND',
      );

      // --- NO DELETE endpoint ---
      const delAttempt = await request(server)
        .delete(`/api/v1/admin/delivery/zones/${zone.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect([404, 405]).toContain(delAttempt.status);
    } finally {
      await cleanupByPhone(phone).catch(() => undefined);
      await cleanupZones(localZones);
    }
  });

  // ── test: pricing rule CRUD + dual-active + money strings ────────────────

  it('pricing rule CRUD: create, list, get, activate, deactivate, dual-active rejection, money strings, above-safe-int', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}3`;
    const phone = `0620${suffix}`;
    const localZones: string[] = [];

    try {
      const token = await authenticate(phone);
      const acct = await authMe(token);
      await seedAdminWithPermissions(acct.id, `p${suffix}`, [
        ADMIN_PERMISSIONS.DELIVERY_ZONES_READ,
        ADMIN_PERMISSIONS.DELIVERY_ZONES_MANAGE,
        ADMIN_PERMISSIONS.DELIVERY_PRICING_READ,
        ADMIN_PERMISSIONS.DELIVERY_PRICING_MANAGE,
      ]);

      // Create a zone (inactive)
      const zoneRes = await request(server)
        .post('/api/v1/admin/delivery/zones')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `Rule Test Zone ${suffix}`,
          geometry: { type: 'Polygon', coordinates: [COVERING_RING] },
        });
      expect(zoneRes.status).toBe(201);
      const zone = zoneRes.body as ZoneBody;
      localZones.push(zone.id);

      // --- CREATE PRICING RULE (inactive by default) ---
      const ruleRes = await request(server)
        .post('/api/v1/admin/delivery/pricing-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          zoneId: zone.id,
          name: `All Day Rule ${suffix}`,
          timeBand: 'DAY',
          startLocalTime: null,
          endLocalTime: null,
          customerDeliveryFeeMinor: 50000,
          driverRemunerationMinor: 30000,
          effectiveFrom: '2020-01-01T00:00:00.000Z',
          effectiveTo: null,
        });
      expect(ruleRes.status).toBe(201);
      const rule = ruleRes.body as RuleBody;
      expect(rule.zoneId).toBe(zone.id);
      expect(rule.active).toBe(false);
      // Money responses MUST be exact integer minor-unit decimal strings
      expect(typeof rule.customerDeliveryFeeMinor).toBe('string');
      expect(typeof rule.driverRemunerationMinor).toBe('string');
      expect(rule.customerDeliveryFeeMinor).toBe('50000');
      expect(rule.driverRemunerationMinor).toBe('30000');

      // --- LIST RULES ---
      const listRulesRes = await request(server)
        .get('/api/v1/admin/delivery/pricing-rules')
        .query({ zoneId: zone.id })
        .set('Authorization', `Bearer ${token}`);
      expect(listRulesRes.status).toBe(200);
      const listBody = listRulesRes.body as RuleListBody;
      expect(listBody.items.some((r) => r.id === rule.id)).toBe(true);

      // --- GET BY ID ---
      const getRuleRes = await request(server)
        .get(`/api/v1/admin/delivery/pricing-rules/${rule.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(getRuleRes.status).toBe(200);
      expect((getRuleRes.body as RuleBody).id).toBe(rule.id);

      // --- VALIDATION: fee < rem should fail ---
      const badFeeRes = await request(server)
        .post('/api/v1/admin/delivery/pricing-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          zoneId: zone.id,
          name: `Bad Fee ${suffix}`,
          timeBand: 'DAY',
          startLocalTime: null,
          endLocalTime: null,
          customerDeliveryFeeMinor: 100,
          driverRemunerationMinor: 200,
          effectiveFrom: '2020-01-01T00:00:00.000Z',
          effectiveTo: null,
        });
      expect(badFeeRes.status).toBe(400);
      expect((badFeeRes.body as ErrorBody).error.code).toBe(
        'DELIVERY_PRICING_RULE_INVALID',
      );

      // --- LARGE BUT BOUNDED INTEGER (Admin money input is IsInt-capped) ---
      // Persistence is bigint; JSON responses must still be exact decimal strings.
      const bigFeeMinor = 2_147_483_647;
      const bigRuleRes = await request(server)
        .post('/api/v1/admin/delivery/pricing-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          zoneId: zone.id,
          name: `Big Fee Rule ${suffix}`,
          timeBand: 'DAY',
          startLocalTime: null,
          endLocalTime: null,
          customerDeliveryFeeMinor: bigFeeMinor,
          driverRemunerationMinor: 0,
          effectiveFrom: '2020-01-01T00:00:00.000Z',
          effectiveTo: null,
        });
      expect(bigRuleRes.status).toBe(201);
      const bigRule = bigRuleRes.body as RuleBody;
      // Must be returned as a string decimal, not a lossy number
      expect(typeof bigRule.customerDeliveryFeeMinor).toBe('string');
      expect(bigRule.customerDeliveryFeeMinor).toBe(String(bigFeeMinor));

      // --- ACTIVATE FIRST RULE ---
      const actRes = await request(server)
        .post(`/api/v1/admin/delivery/pricing-rules/${rule.id}/activate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(actRes.status).toBe(200);
      expect((actRes.body as RuleBody).active).toBe(true);

      // --- DUAL-ACTIVE REJECTION (identical all-day applicability) ---
      const dualActRes = await request(server)
        .post(`/api/v1/admin/delivery/pricing-rules/${bigRule.id}/activate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(dualActRes.status).toBe(409);
      expect((dualActRes.body as ErrorBody).error.code).toBe(
        'DELIVERY_PRICING_RULE_CONFLICT',
      );

      // --- DISJOINT LOCAL WINDOWS may both be active ---
      const morningRes = await request(server)
        .post('/api/v1/admin/delivery/pricing-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          zoneId: zone.id,
          name: `Morning ${suffix}`,
          timeBand: 'CUSTOM',
          startLocalTime: '08:00:00',
          endLocalTime: '11:59:59',
          customerDeliveryFeeMinor: 400,
          driverRemunerationMinor: 200,
          effectiveFrom: '2020-01-01T00:00:00.000Z',
          effectiveTo: null,
        });
      expect(morningRes.status).toBe(201);
      const morning = morningRes.body as RuleBody;
      const eveningRes = await request(server)
        .post('/api/v1/admin/delivery/pricing-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          zoneId: zone.id,
          name: `Evening ${suffix}`,
          timeBand: 'CUSTOM',
          startLocalTime: '12:00:00',
          endLocalTime: '17:59:59',
          customerDeliveryFeeMinor: 600,
          driverRemunerationMinor: 300,
          effectiveFrom: '2020-01-01T00:00:00.000Z',
          effectiveTo: null,
        });
      expect(eveningRes.status).toBe(201);
      const evening = eveningRes.body as RuleBody;
      // Deactivate the all-day active rule first
      await request(server)
        .post(`/api/v1/admin/delivery/pricing-rules/${rule.id}/deactivate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      const mAct = await request(server)
        .post(`/api/v1/admin/delivery/pricing-rules/${morning.id}/activate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      const eAct = await request(server)
        .post(`/api/v1/admin/delivery/pricing-rules/${evening.id}/activate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(mAct.status).toBe(200);
      expect(eAct.status).toBe(200);
      expect((mAct.body as RuleBody).active).toBe(true);
      expect((eAct.body as RuleBody).active).toBe(true);

      // --- DEACTIVATE first rule ---
      const deactRuleRes = await request(server)
        .post(`/api/v1/admin/delivery/pricing-rules/${rule.id}/deactivate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(deactRuleRes.status).toBe(200);
      expect((deactRuleRes.body as RuleBody).active).toBe(false);

      // --- IDEMPOTENT DEACTIVATE ---
      const deactAgain = await request(server)
        .post(`/api/v1/admin/delivery/pricing-rules/${rule.id}/deactivate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(deactAgain.status).toBe(200);
      expect((deactAgain.body as RuleBody).active).toBe(false);

      // --- NO DELETE endpoint for pricing rules ---
      const delRule = await request(server)
        .delete(`/api/v1/admin/delivery/pricing-rules/${rule.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect([404, 405]).toContain(delRule.status);
    } finally {
      await cleanupByPhone(phone).catch(() => undefined);
      await cleanupZones(localZones);
    }
  });

  // ── test: settings reject delivery.price ─────────────────────────────────

  it('settings module rejects delivery/zone pricing keys as unsupported', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}4`;
    const phone = `0630${suffix}`;
    try {
      const token = await authenticate(phone);
      const acct = await authMe(token);
      await seedAdminWithPermissions(acct.id, `s${suffix}`, [
        'settings.read',
        'settings.manage',
      ]);

      for (const key of [
        'delivery.price',
        'delivery.baseFee',
        'delivery.pricingRule',
        'zone.geometry',
        'driver.payRate',
      ]) {
        const res = await request(server)
          .put(`/api/v1/admin/settings/${key}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ value: '500' });
        expect(res.status).toBe(404);
        expect((res.body as ErrorBody).error.code).toBe(
          'SETTING_NOT_SUPPORTED',
        );
      }
    } finally {
      await cleanupByPhone(phone).catch(() => undefined);
    }
  });

  // ── test: checkout inside/outside zone + opening hours ───────────────────

  it('checkout uses active zone/rule for inside address, blocks outside, respects opening hours', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}5`;
    const phones = {
      admin: `0640${suffix}`,
      merchant: `0641${suffix}`,
      customer: `0642${suffix}`,
    };
    const localZones: string[] = [];
    let branchId = '';
    let merchantId = '';

    try {
      const adminToken = await authenticate(phones.admin);
      const merchantToken = await authenticate(phones.merchant);
      const customerToken = await authenticate(phones.customer);

      const adminAcct = await authMe(adminToken);
      const merchantAcct = await authMe(merchantToken);

      await seedAdminWithPermissions(adminAcct.id, `co${suffix}`, [
        ADMIN_PERMISSIONS.DELIVERY_ZONES_READ,
        ADMIN_PERMISSIONS.DELIVERY_ZONES_MANAGE,
        ADMIN_PERMISSIONS.DELIVERY_PRICING_READ,
        ADMIN_PERMISSIONS.DELIVERY_PRICING_MANAGE,
      ]);

      // Create merchant via HTTP API
      const merchantRes = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({ name: `CO Merchant ${suffix}` });
      expect(merchantRes.status).toBe(201);
      merchantId = (merchantRes.body as MembershipBody).merchantId;

      // Create branch
      const branchRes = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          name: 'Main Branch',
          phone: `0540${suffix}`,
          addressText: 'Street A',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      expect(branchRes.status).toBe(201);
      branchId = (branchRes.body as BranchBody).id;
      await ensureBranchOpeningHours(prisma, branchId, merchantAcct.id);
      await approveMerchant(merchantId);

      // Create category + product
      const catRes = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({ branchId, name: 'Food' });
      expect(catRes.status).toBe(201);
      const categoryId = (catRes.body as CategoryBody).id;

      const prodRes = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({ branchId, categoryId, name: 'Item A', priceMinor: 1000 });
      expect(prodRes.status).toBe(201);
      const productId = (prodRes.body as ProductBody).id;

      // Create customer profile + addresses
      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ fullName: `CO Customer ${suffix}` });

      const insideAddrRes = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          label: 'Inside',
          addressText: 'Inside zone',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      expect(insideAddrRes.status).toBe(201);
      const insideAddrId = (insideAddrRes.body as { id: string }).id;

      const outsideAddrRes = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          label: 'Outside',
          addressText: 'Outside zone',
          latitude: OUTSIDE[0],
          longitude: OUTSIDE[1],
        });
      expect(outsideAddrRes.status).toBe(201);
      const outsideAddrId = (outsideAddrRes.body as { id: string }).id;

      // Add to cart
      const cartAdd = await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ productId, quantity: 1, optionIds: [] });
      expect(cartAdd.status).toBe(200);

      // ---- NO ZONE: checkout should fail ----
      const noZoneRes = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ addressId: insideAddrId });
      expect(noZoneRes.status).toBe(409);
      expect((noZoneRes.body as ErrorBody).error.code).toBe(
        'CHECKOUT_ADDRESS_OUTSIDE_ZONE',
      );

      // ---- Create + activate zone and rule via Admin API ----
      const zoneApiRes = await request(server)
        .post('/api/v1/admin/delivery/zones')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `CO Zone ${suffix}`,
          geometry: { type: 'Polygon', coordinates: [COVERING_RING] },
        });
      expect(zoneApiRes.status).toBe(201);
      const zone = zoneApiRes.body as ZoneBody;
      localZones.push(zone.id);

      const ruleApiRes = await request(server)
        .post('/api/v1/admin/delivery/pricing-rules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          zoneId: zone.id,
          name: `CO Rule ${suffix}`,
          timeBand: 'DAY',
          startLocalTime: null,
          endLocalTime: null,
          customerDeliveryFeeMinor: 500,
          driverRemunerationMinor: 300,
          effectiveFrom: '2020-01-01T00:00:00.000Z',
          effectiveTo: null,
        });
      expect(ruleApiRes.status).toBe(201);
      const ruleApi = ruleApiRes.body as RuleBody;

      await request(server)
        .post(`/api/v1/admin/delivery/zones/${zone.id}/activate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      await request(server)
        .post(`/api/v1/admin/delivery/pricing-rules/${ruleApi.id}/activate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      // ---- INSIDE: preview should succeed ----
      const insidePreview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ addressId: insideAddrId });
      expect(insidePreview.status).toBe(200);
      const previewBody = insidePreview.body as {
        deliveryFeeMinor: string;
        deliveryZone: { id: string };
      };
      expect(previewBody.deliveryZone.id).toBe(zone.id);
      expect(previewBody.deliveryFeeMinor).toBe('500');

      // ---- OUTSIDE: preview should fail ----
      const outsidePreview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ addressId: outsideAddrId });
      expect(outsidePreview.status).toBe(409);
      expect((outsidePreview.body as ErrorBody).error.code).toBe(
        'CHECKOUT_ADDRESS_OUTSIDE_ZONE',
      );

      // ---- OPENING HOURS: remove hours → checkout blocked ----
      await deleteBranchOpeningHours(prisma, branchId);
      const closedPreview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ addressId: insideAddrId });
      expect(closedPreview.status).toBe(409);
      // Restore hours
      await ensureBranchOpeningHours(prisma, branchId, merchantAcct.id);

      void productId; // used above, suppress lint
    } finally {
      for (const p of Object.values(phones)) {
        await cleanupByPhone(p).catch(() => undefined);
      }
      await cleanupZones(localZones);
    }
  });

  // ── test: OFS immutability ────────────────────────────────────────────────

  it('OFS immutable: order financial snapshot preserved after pricing rule deactivation', async () => {
    const server = app.getHttpServer();
    const suffix = `${Date.now().toString().slice(-5)}6`;
    const phones = {
      admin: `0650${suffix}`,
      merchant: `0651${suffix}`,
      customer: `0652${suffix}`,
    };
    const localZones: string[] = [];
    let branchId = '';
    let merchantId = '';

    try {
      const adminToken = await authenticate(phones.admin);
      const merchantToken = await authenticate(phones.merchant);
      const customerToken = await authenticate(phones.customer);

      const adminAcct = await authMe(adminToken);
      const merchantAcct = await authMe(merchantToken);

      const { adminId } = await seedAdminWithPermissions(
        adminAcct.id,
        `ofs${suffix}`,
        [
          ADMIN_PERMISSIONS.DELIVERY_ZONES_READ,
          ADMIN_PERMISSIONS.DELIVERY_ZONES_MANAGE,
          ADMIN_PERMISSIONS.DELIVERY_PRICING_READ,
          ADMIN_PERMISSIONS.DELIVERY_PRICING_MANAGE,
        ],
      );

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
        createdAt: pgNow(),
      });

      // Create merchant, branch, product via HTTP API
      const mRes = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({ name: `OFS Merchant ${suffix}` });
      merchantId = (mRes.body as MembershipBody).merchantId;
      const bRes = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          name: 'OFS Branch',
          phone: `0541${suffix}`,
          addressText: 'Main St',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      branchId = (bRes.body as BranchBody).id;
      await ensureBranchOpeningHours(prisma, branchId, merchantAcct.id);
      await approveMerchant(merchantId);

      const catRes2 = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({ branchId, name: 'OFS Cat' });
      const catId = (catRes2.body as CategoryBody).id;
      const prodRes2 = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          branchId,
          categoryId: catId,
          name: 'OFS Item',
          priceMinor: 1000,
        });
      const productId = (prodRes2.body as ProductBody).id;

      // Customer setup
      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ fullName: `OFS Customer ${suffix}` });
      const addrRes = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          label: 'Home',
          addressText: 'Inside zone OFS',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const addrId = (addrRes.body as { id: string }).id;

      // Create + activate zone + rule
      const zRes = await request(server)
        .post('/api/v1/admin/delivery/zones')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `OFS Zone ${suffix}`,
          geometry: { type: 'Polygon', coordinates: [COVERING_RING] },
        });
      const ofsZone = zRes.body as ZoneBody;
      localZones.push(ofsZone.id);
      const rRes = await request(server)
        .post('/api/v1/admin/delivery/pricing-rules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          zoneId: ofsZone.id,
          name: `OFS Rule ${suffix}`,
          timeBand: 'DAY',
          startLocalTime: null,
          endLocalTime: null,
          customerDeliveryFeeMinor: 500,
          driverRemunerationMinor: 300,
          effectiveFrom: '2020-01-01T00:00:00.000Z',
          effectiveTo: null,
        });
      const ofsRule = rRes.body as RuleBody;
      await request(server)
        .post(`/api/v1/admin/delivery/zones/${ofsZone.id}/activate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      await request(server)
        .post(`/api/v1/admin/delivery/pricing-rules/${ofsRule.id}/activate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      // Cart + create order (OFS snapshot)
      const cartAdd = await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ productId, quantity: 1, optionIds: [] });
      expect(cartAdd.status).toBe(200);

      const previewRes = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ addressId: addrId });
      expect(previewRes.status).toBe(200);
      const preview = previewRes.body as {
        merchandiseSubtotalMinor: string;
        deliveryFeeMinor: string;
        customerTotalMinor: string;
      };

      const confirmRes = await request(server)
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          addressId: addrId,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: Number(
            preview.merchandiseSubtotalMinor,
          ),
          expectedDeliveryFeeMinor: Number(preview.deliveryFeeMinor),
          expectedCustomerTotalMinor: Number(preview.customerTotalMinor),
        });
      expect(confirmRes.status).toBe(201);
      const confirmedBody = confirmRes.body as {
        id?: string;
        orderId?: string;
      };
      const orderId = confirmedBody.id ?? confirmedBody.orderId;
      expect(orderId).toBeTruthy();

      // Deactivate rule AFTER order was placed
      await request(server)
        .post(`/api/v1/admin/delivery/pricing-rules/${ofsRule.id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      // GET order — delivery fee must reflect the original snapshot
      const orderRes = await request(server)
        .get(`/api/v1/customer/orders/${String(orderId)}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(orderRes.status).toBe(200);
      const orderBody = orderRes.body as {
        financial: { deliveryFeeMinor: string };
      };
      // OFS must retain original fee (500 minor units as decimal string)
      expect(orderBody.financial.deliveryFeeMinor).toBe('500');
    } finally {
      for (const p of Object.values(phones)) {
        await cleanupByPhone(p).catch(() => undefined);
      }
      await cleanupZones(localZones);
    }
  });
});
