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
import { AdminAuditService } from '../src/modules/admin/application/admin-audit.service';
import { ADMIN_AUDIT_ACTIONS } from '../src/modules/admin/domain/admin-audit-actions';
import { adminAuditFailed } from '../src/modules/admin/domain/admin.errors';
import { ADMIN_PERMISSIONS } from '../src/modules/admin/domain/admin-permissions';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { PermissionService } from '../src/modules/authorization/permission.service';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';
import {
  deleteBranchOpeningHours,
  ensureBranchOpeningHours,
} from './helpers/ensure-branch-opening-hours';
import { deactivateOpenGlobalCommissionDefaults } from './helpers/sanitize-commission-globals';
import { deactivateAllDeliveryZones } from './helpers/sanitize-delivery-zones';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type AuthMeBody = { account: { id: string; phone: string } };
type ZoneBody = {
  id: string;
  name: string;
  geometry: { type: string; coordinates: unknown };
  active: boolean;
};
type RuleBody = {
  id: string;
  zoneId: string;
  name: string;
  customerDeliveryFeeMinor: string;
  driverRemunerationMinor: string;
  active: boolean;
};
type MembershipBody = { merchantId: string };
type BranchBody = { id: string };
type CategoryBody = { id: string };
type ProductBody = { id: string };
type PreviewBody = {
  merchandiseSubtotalMinor: string;
  deliveryFeeMinor: string;
  customerTotalMinor: string;
  deliveryZone: { id: string };
  pricing: { ruleId: string };
};

const INSIDE: [number, number] = [36.75, 3.05];
const INSIDE_A: [number, number] = [36.75, 3.025];
const INSIDE_B: [number, number] = [36.75, 3.075];
const SHARED: [number, number] = [36.75, 3.05];

const ZONE_A_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.05, 36.7],
  [3.05, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];
const ZONE_B_RING: Array<[number, number]> = [
  [3.05, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.05, 36.8],
  [3.05, 36.7],
];
const OVERLAP_CONTAINED: Array<[number, number]> = [
  [3.01, 36.72],
  [3.04, 36.72],
  [3.04, 36.78],
  [3.01, 36.78],
  [3.01, 36.72],
];
const PARTIAL_OVERLAP: Array<[number, number]> = [
  [2.99, 36.74],
  [3.01, 36.74],
  [3.01, 36.76],
  [2.99, 36.76],
  [2.99, 36.74],
];
const TOUCH_EDGE_ONLY: Array<[number, number]> = [
  [2.95, 36.7],
  [3.0, 36.7],
  [3.0, 36.8],
  [2.95, 36.8],
  [2.95, 36.7],
];
const TOUCH_CORNER: Array<[number, number]> = [
  [2.95, 36.65],
  [3.0, 36.65],
  [3.0, 36.7],
  [2.95, 36.7],
  [2.95, 36.65],
];
const IDENTICAL = ZONE_A_RING.map((point) => [...point] as [number, number]);

const DELIVERY_PERMISSIONS = [
  ADMIN_PERMISSIONS.DELIVERY_ZONES_READ,
  ADMIN_PERMISSIONS.DELIVERY_ZONES_MANAGE,
  ADMIN_PERMISSIONS.DELIVERY_PRICING_READ,
  ADMIN_PERMISSIONS.DELIVERY_PRICING_MANAGE,
  ADMIN_PERMISSIONS.AUDIT_READ,
  ADMIN_PERMISSIONS.SETTINGS_READ,
  ADMIN_PERMISSIONS.SETTINGS_MANAGE,
];

describe('Admin Delivery Zones + Pricing P1-I hardening (e2e)', () => {
  jest.setTimeout(300_000);

  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let permissions: PermissionService;
  let audit: AdminAuditService;

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
    audit = app.get(AdminAuditService);
    await deactivateAllDeliveryZones(prisma);
    const leftovers = await redis.getClient().keys('auth:test:*');
    if (leftovers.length > 0) {
      await redis.getClient().del(...leftovers);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
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
        deviceName: 'delivery-hardening-e2e',
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
  ): Promise<{ adminId: string; roleId: string }> {
    const now = pgNow();
    const roleId = createUuidV7();
    await prisma.getDb().orm.public.Role.create({
      id: roleId,
      name: pgVarchar<128>(`adz-hardening-${suffix}`),
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
      displayName: pgVarchar<255>(`Delivery Hardening Admin ${suffix}`),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await permissions.invalidate(accountId);
    return { adminId, roleId };
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
    const customer = await db.CustomerProfile.where({
      accountId: account.id,
    }).first();
    if (customer) {
      const carts = await db.Cart.where({ customerId: customer.id }).all();
      for (const cart of carts) {
        await db.Cart.where({ id: cart.id }).delete();
      }
      const orders = await db.Order.where({ customerId: customer.id }).all();
      for (const order of orders) {
        await db.Order.where({ id: order.id }).delete();
      }
      const addresses = await db.Address.where({
        customerId: customer.id,
      }).all();
      for (const address of addresses) {
        await db.Address.where({ id: address.id }).delete();
      }
      await db.CustomerProfile.where({ id: customer.id }).delete();
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
        const products = await db.Product.where({
          merchantBranchId: branch.id,
        }).all();
        for (const product of products) {
          await db.Product.where({ id: product.id }).delete();
        }
        const categories = await db.Category.where({
          merchantBranchId: branch.id,
        }).all();
        for (const category of categories) {
          await db.Category.where({ id: category.id }).delete();
        }
        await db.MerchantBranch.where({ id: branch.id }).delete();
      }
      await db.MerchantMember.where({
        merchantId: member.merchantId,
        accountId: account.id,
      }).delete();
      await db.Merchant.where({ id: member.merchantId }).delete();
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

  async function cleanupZones(zoneIds: string[]): Promise<void> {
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

  async function adminFixture(
    phone: string,
    suffix: string,
  ): Promise<{ token: string; adminId: string }> {
    const token = await authenticate(phone);
    const account = await authMe(token);
    const seeded = await seedAdminWithPermissions(
      account.id,
      suffix,
      DELIVERY_PERMISSIONS,
    );
    return { token, adminId: seeded.adminId };
  }

  async function createZone(
    token: string,
    name: string,
    ring: Array<[number, number]>,
  ): Promise<ZoneBody> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/delivery/zones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name,
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
    expect(response.status).toBe(201);
    return response.body as ZoneBody;
  }

  async function activateZone(token: string, zoneId: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/admin/delivery/zones/${zoneId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  async function createRule(
    token: string,
    input: {
      zoneId: string;
      name: string;
      customerDeliveryFeeMinor?: number;
      driverRemunerationMinor?: number;
      startLocalTime?: string | null;
      endLocalTime?: string | null;
    },
  ): Promise<RuleBody> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/delivery/pricing-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({
        zoneId: input.zoneId,
        name: input.name,
        timeBand:
          input.startLocalTime == null && input.endLocalTime == null
            ? 'DAY'
            : 'CUSTOM',
        startLocalTime: input.startLocalTime ?? null,
        endLocalTime: input.endLocalTime ?? null,
        customerDeliveryFeeMinor: input.customerDeliveryFeeMinor ?? 500,
        driverRemunerationMinor: input.driverRemunerationMinor ?? 300,
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveTo: null,
      });
    expect(response.status).toBe(201);
    return response.body as RuleBody;
  }

  async function activateRule(token: string, ruleId: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/admin/delivery/pricing-rules/${ruleId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  async function seedCommission(adminId: string): Promise<string> {
    await deactivateOpenGlobalCommissionDefaults(prisma);
    const id = createUuidV7();
    await prisma.getDb().orm.public.MerchantCommissionRule.create({
      id,
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
    return id;
  }

  async function commerceFixture(
    suffix: string,
    merchantPhone: string,
    customerPhone: string,
    addresses: Record<string, [number, number]>,
  ): Promise<{
    merchantToken: string;
    customerToken: string;
    productId: string;
    addressIds: Record<string, string>;
  }> {
    const server = app.getHttpServer();
    const merchantToken = await authenticate(merchantPhone);
    const customerToken = await authenticate(customerPhone);
    const merchantAccount = await authMe(merchantToken);

    const merchantResponse = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ name: `Hardening Merchant ${suffix}` });
    expect(merchantResponse.status).toBe(201);
    const merchantId = (merchantResponse.body as MembershipBody).merchantId;

    const branchResponse = await request(server)
      .post(`/api/v1/merchant/${merchantId}/branches`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        name: 'Hardening Branch',
        phone: `0550${suffix}`,
        addressText: 'Hardening Street',
        latitude: INSIDE[0],
        longitude: INSIDE[1],
      });
    expect(branchResponse.status).toBe(201);
    const branchId = (branchResponse.body as BranchBody).id;
    await ensureBranchOpeningHours(prisma, branchId, merchantAccount.id);
    await approveMerchant(merchantId);

    const categoryResponse = await request(server)
      .post(`/api/v1/merchant/${merchantId}/categories`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ branchId, name: 'Hardening Food' });
    expect(categoryResponse.status).toBe(201);
    const categoryId = (categoryResponse.body as CategoryBody).id;

    const productResponse = await request(server)
      .post(`/api/v1/merchant/${merchantId}/products`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        branchId,
        categoryId,
        name: 'Hardening Item',
        priceMinor: 1000,
      });
    expect(productResponse.status).toBe(201);
    const productId = (productResponse.body as ProductBody).id;

    const profileResponse = await request(server)
      .post('/api/v1/customer/profile')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: `Hardening Customer ${suffix}` });
    expect(profileResponse.status).toBe(201);

    const addressIds: Record<string, string> = {};
    for (const [label, coordinates] of Object.entries(addresses)) {
      const addressResponse = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          label,
          addressText: `${label} address`,
          latitude: coordinates[0],
          longitude: coordinates[1],
        });
      expect(addressResponse.status).toBe(201);
      addressIds[label] = (addressResponse.body as { id: string }).id;
    }

    const cartResponse = await request(server)
      .post('/api/v1/customer/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId, quantity: 1, optionIds: [] });
    expect(cartResponse.status).toBe(200);

    return { merchantToken, customerToken, productId, addressIds };
  }

  it('topology: interior overlap / containment / identical rejected; edge+corner touch allowed', async () => {
    const suffix = `${Date.now().toString().slice(-5)}1`;
    const phone = `0660${suffix}`;
    const zoneIds: string[] = [];
    try {
      const { token } = await adminFixture(phone, `top${suffix}`);
      const zoneA = await createZone(
        token,
        `Topology A ${suffix}`,
        ZONE_A_RING,
      );
      zoneIds.push(zoneA.id);
      expect((await activateZone(token, zoneA.id)).status).toBe(200);

      const getA = await request(app.getHttpServer())
        .get(`/api/v1/admin/delivery/zones/${zoneA.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(getA.status).toBe(200);
      expect((getA.body as ZoneBody).geometry).toEqual({
        type: 'MultiPolygon',
        coordinates: [[ZONE_A_RING]],
      });

      for (const [name, ring] of [
        ['contained', OVERLAP_CONTAINED],
        ['identical', IDENTICAL],
        ['partial', PARTIAL_OVERLAP],
      ] as Array<[string, Array<[number, number]>]>) {
        const candidate = await createZone(
          token,
          `Topology ${name} ${suffix}`,
          ring,
        );
        zoneIds.push(candidate.id);
        const activation = await activateZone(token, candidate.id);
        expect(activation.status).toBe(409);
        expect((activation.body as ErrorBody).error.code).toBe(
          'DELIVERY_ZONE_OVERLAP',
        );
      }

      const edge = await createZone(
        token,
        `Topology edge ${suffix}`,
        TOUCH_EDGE_ONLY,
      );
      const corner = await createZone(
        token,
        `Topology corner ${suffix}`,
        TOUCH_CORNER,
      );
      zoneIds.push(edge.id, corner.id);
      expect((await activateZone(token, edge.id)).status).toBe(200);
      expect((await activateZone(token, corner.id)).status).toBe(200);
    } finally {
      await cleanupByPhone(phone).catch(() => undefined);
      await cleanupZones(zoneIds);
    }
  });

  it('shared-boundary ST_Covers fails closed', async () => {
    const suffix = `${Date.now().toString().slice(-5)}2`;
    const phones = {
      admin: `0670${suffix}`,
      merchant: `0671${suffix}`,
      customer: `0672${suffix}`,
    };
    const zoneIds: string[] = [];
    try {
      const { token, adminId } = await adminFixture(
        phones.admin,
        `shared${suffix}`,
      );
      await seedCommission(adminId);
      const zoneA = await createZone(token, `Shared A ${suffix}`, ZONE_A_RING);
      const zoneB = await createZone(token, `Shared B ${suffix}`, ZONE_B_RING);
      zoneIds.push(zoneA.id, zoneB.id);
      expect((await activateZone(token, zoneA.id)).status).toBe(200);
      expect((await activateZone(token, zoneB.id)).status).toBe(200);
      const ruleA = await createRule(token, {
        zoneId: zoneA.id,
        name: `Shared Rule A ${suffix}`,
        customerDeliveryFeeMinor: 500,
        driverRemunerationMinor: 300,
      });
      const ruleB = await createRule(token, {
        zoneId: zoneB.id,
        name: `Shared Rule B ${suffix}`,
        customerDeliveryFeeMinor: 500,
        driverRemunerationMinor: 300,
      });
      expect((await activateRule(token, ruleA.id)).status).toBe(200);
      expect((await activateRule(token, ruleB.id)).status).toBe(200);

      const commerce = await commerceFixture(
        suffix,
        phones.merchant,
        phones.customer,
        { InsideA: INSIDE_A, InsideB: INSIDE_B, Shared: SHARED },
      );
      const previewA = await request(app.getHttpServer())
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${commerce.customerToken}`)
        .send({ addressId: commerce.addressIds.InsideA });
      expect(previewA.status).toBe(200);
      expect((previewA.body as PreviewBody).deliveryZone.id).toBe(zoneA.id);

      const previewB = await request(app.getHttpServer())
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${commerce.customerToken}`)
        .send({ addressId: commerce.addressIds.InsideB });
      expect(previewB.status).toBe(200);
      expect((previewB.body as PreviewBody).deliveryZone.id).toBe(zoneB.id);

      const previewShared = await request(app.getHttpServer())
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${commerce.customerToken}`)
        .send({ addressId: commerce.addressIds.Shared });
      expect(previewShared.status).toBe(409);
      expect((previewShared.body as ErrorBody).error.code).toBe(
        'CHECKOUT_DELIVERY_ZONE_AMBIGUOUS',
      );
    } finally {
      for (const phone of Object.values(phones)) {
        await cleanupByPhone(phone).catch(() => undefined);
      }
      await cleanupZones(zoneIds);
    }
  });

  it('concurrent overlapping zone activation: exactly one wins', async () => {
    const suffix = `${Date.now().toString().slice(-5)}3`;
    const phone = `0680${suffix}`;
    const zoneIds: string[] = [];
    try {
      const { token, adminId } = await adminFixture(phone, `cz${suffix}`);
      const first = await createZone(
        token,
        `Concurrent Zone 1 ${suffix}`,
        ZONE_A_RING,
      );
      const second = await createZone(
        token,
        `Concurrent Zone 2 ${suffix}`,
        OVERLAP_CONTAINED,
      );
      zoneIds.push(first.id, second.id);

      const results = await Promise.all([
        activateZone(token, first.id),
        activateZone(token, second.id),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      const winnerId = results[0].status === 200 ? first.id : second.id;

      const rows = await Promise.all(
        zoneIds.map((id) =>
          prisma.getDb().orm.public.DeliveryZone.where({ id }).first(),
        ),
      );
      expect(rows.filter((row) => row?.active).map((row) => row?.id)).toEqual([
        winnerId,
      ]);
      const winnerAudits = await prisma
        .getDb()
        .orm.public.AuditLog.where({
          adminId,
          action: pgVarchar<128>(ADMIN_AUDIT_ACTIONS.DELIVERY_ZONE_ACTIVATE),
          targetId: winnerId,
        })
        .all();
      expect(winnerAudits.length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanupByPhone(phone).catch(() => undefined);
      await cleanupZones(zoneIds);
    }
  });

  it('concurrent conflicting pricing activation: exactly one wins', async () => {
    const suffix = `${Date.now().toString().slice(-5)}4`;
    const phone = `0690${suffix}`;
    const zoneIds: string[] = [];
    try {
      const { token } = await adminFixture(phone, `cp${suffix}`);
      const zone = await createZone(
        token,
        `Concurrent Pricing Zone ${suffix}`,
        ZONE_A_RING,
      );
      zoneIds.push(zone.id);
      expect((await activateZone(token, zone.id)).status).toBe(200);
      const first = await createRule(token, {
        zoneId: zone.id,
        name: `Concurrent Rule 1 ${suffix}`,
      });
      const second = await createRule(token, {
        zoneId: zone.id,
        name: `Concurrent Rule 2 ${suffix}`,
      });

      const results = await Promise.all([
        activateRule(token, first.id),
        activateRule(token, second.id),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      const rows = await prisma
        .getDb()
        .orm.public.DeliveryPricingRule.where({ zoneId: zone.id })
        .all();
      expect(rows.filter((row) => row.active)).toHaveLength(1);
    } finally {
      await cleanupByPhone(phone).catch(() => undefined);
      await cleanupZones(zoneIds);
    }
  });

  it('concurrent disjoint pricing activation: both may succeed', async () => {
    const suffix = `${Date.now().toString().slice(-5)}5`;
    const phone = `0700${suffix}`;
    const zoneIds: string[] = [];
    try {
      const { token } = await adminFixture(phone, `dp${suffix}`);
      const zone = await createZone(
        token,
        `Disjoint Pricing Zone ${suffix}`,
        ZONE_A_RING,
      );
      zoneIds.push(zone.id);
      expect((await activateZone(token, zone.id)).status).toBe(200);
      const morning = await createRule(token, {
        zoneId: zone.id,
        name: `Morning ${suffix}`,
        startLocalTime: '08:00:00',
        endLocalTime: '11:59:59',
      });
      const evening = await createRule(token, {
        zoneId: zone.id,
        name: `Evening ${suffix}`,
        startLocalTime: '12:00:00',
        endLocalTime: '17:59:59',
      });

      const results = await Promise.all([
        activateRule(token, morning.id),
        activateRule(token, evening.id),
      ]);
      expect(results.map((result) => result.status)).toEqual([200, 200]);
      const rows = await prisma
        .getDb()
        .orm.public.DeliveryPricingRule.where({ zoneId: zone.id })
        .all();
      expect(rows.filter((row) => row.active)).toHaveLength(2);
    } finally {
      await cleanupByPhone(phone).catch(() => undefined);
      await cleanupZones(zoneIds);
    }
  });

  it('audit rollback: zone activate + pricing activate', async () => {
    const suffix = `${Date.now().toString().slice(-5)}6`;
    const phone = `0710${suffix}`;
    const zoneIds: string[] = [];
    let spy: jest.SpiedFunction<AdminAuditService['recordInTx']> | undefined;
    try {
      const { token } = await adminFixture(phone, `audit${suffix}`);
      const zone = await createZone(
        token,
        `Audit Rollback Zone ${suffix}`,
        ZONE_A_RING,
      );
      zoneIds.push(zone.id);

      spy = jest
        .spyOn(audit, 'recordInTx')
        .mockRejectedValueOnce(
          adminAuditFailed('simulated zone audit failure'),
        );
      const zoneActivation = await activateZone(token, zone.id);
      expect(zoneActivation.status).toBe(500);
      expect((zoneActivation.body as ErrorBody).error.code).toBe(
        'ADMIN_AUDIT_FAILED',
      );
      const zoneAfter = await prisma
        .getDb()
        .orm.public.DeliveryZone.where({ id: zone.id })
        .first();
      expect(zoneAfter?.active).toBe(false);
      spy.mockRestore();
      spy = undefined;

      const rule = await createRule(token, {
        zoneId: zone.id,
        name: `Audit Rollback Rule ${suffix}`,
      });
      spy = jest
        .spyOn(audit, 'recordInTx')
        .mockRejectedValueOnce(
          adminAuditFailed('simulated rule audit failure'),
        );
      const ruleActivation = await activateRule(token, rule.id);
      expect(ruleActivation.status).toBe(500);
      expect((ruleActivation.body as ErrorBody).error.code).toBe(
        'ADMIN_AUDIT_FAILED',
      );
      const ruleAfter = await prisma
        .getDb()
        .orm.public.DeliveryPricingRule.where({ id: rule.id })
        .first();
      expect(ruleAfter?.active).toBe(false);
    } finally {
      spy?.mockRestore();
      await cleanupByPhone(phone).catch(() => undefined);
      await cleanupZones(zoneIds);
    }
  });

  it('OFS immutability after rule/zone deactivate', async () => {
    const suffix = `${Date.now().toString().slice(-5)}7`;
    const phones = {
      admin: `0720${suffix}`,
      merchant: `0721${suffix}`,
      customer: `0722${suffix}`,
    };
    const zoneIds: string[] = [];
    try {
      const { token, adminId } = await adminFixture(
        phones.admin,
        `ofs${suffix}`,
      );
      await seedCommission(adminId);
      const zone = await createZone(token, `OFS Zone ${suffix}`, ZONE_A_RING);
      zoneIds.push(zone.id);
      const rule = await createRule(token, {
        zoneId: zone.id,
        name: `OFS Rule ${suffix}`,
        customerDeliveryFeeMinor: 500,
        driverRemunerationMinor: 300,
      });
      expect((await activateZone(token, zone.id)).status).toBe(200);
      expect((await activateRule(token, rule.id)).status).toBe(200);

      const commerce = await commerceFixture(
        suffix,
        phones.merchant,
        phones.customer,
        { Home: INSIDE_A },
      );
      const previewResponse = await request(app.getHttpServer())
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${commerce.customerToken}`)
        .send({ addressId: commerce.addressIds.Home });
      expect(previewResponse.status).toBe(200);
      const preview = previewResponse.body as PreviewBody;

      const orderResponse = await request(app.getHttpServer())
        .post('/api/v1/customer/orders')
        .set('Authorization', `Bearer ${commerce.customerToken}`)
        .send({
          addressId: commerce.addressIds.Home,
          paymentMethod: 'COD',
          expectedMerchandiseSubtotalMinor: Number(
            preview.merchandiseSubtotalMinor,
          ),
          expectedDeliveryFeeMinor: Number(preview.deliveryFeeMinor),
          expectedCustomerTotalMinor: Number(preview.customerTotalMinor),
        });
      expect(orderResponse.status).toBe(201);
      const orderResult = orderResponse.body as {
        id?: string;
        orderId?: string;
      };
      const orderId = orderResult.id ?? orderResult.orderId;
      expect(orderId).toBeTruthy();

      const before = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({
          orderId: String(orderId),
        })
        .first();
      expect(before).not.toBeNull();
      expect(String(before?.customerDeliveryFeeMinor)).toBe('500');
      expect(before?.pricingRuleId).toBe(rule.id);

      const deactivateRule = await request(app.getHttpServer())
        .post(`/api/v1/admin/delivery/pricing-rules/${rule.id}/deactivate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(deactivateRule.status).toBe(200);
      const deactivateZone = await request(app.getHttpServer())
        .post(`/api/v1/admin/delivery/zones/${zone.id}/deactivate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(deactivateZone.status).toBe(200);

      const getOrder = await request(app.getHttpServer())
        .get(`/api/v1/customer/orders/${String(orderId)}`)
        .set('Authorization', `Bearer ${commerce.customerToken}`);
      expect(getOrder.status).toBe(200);
      expect(
        (
          getOrder.body as {
            financial: { deliveryFeeMinor: string };
          }
        ).financial.deliveryFeeMinor,
      ).toBe(preview.deliveryFeeMinor);

      const after = await prisma
        .getDb()
        .orm.public.OrderFinancialSnapshot.where({
          orderId: String(orderId),
        })
        .first();
      expect(String(after?.customerDeliveryFeeMinor)).toBe(
        String(before?.customerDeliveryFeeMinor),
      );
      expect(after?.pricingRuleId).toBe(before?.pricingRuleId);

      const refill = await request(app.getHttpServer())
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${commerce.customerToken}`)
        .send({ productId: commerce.productId, quantity: 1, optionIds: [] });
      expect(refill.status).toBe(200);
      const newPreview = await request(app.getHttpServer())
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${commerce.customerToken}`)
        .send({ addressId: commerce.addressIds.Home });
      expect(newPreview.status).toBe(409);
      expect([
        'CHECKOUT_ADDRESS_OUTSIDE_ZONE',
        'CHECKOUT_DELIVERY_PRICING_UNAVAILABLE',
      ]).toContain((newPreview.body as ErrorBody).error.code);
    } finally {
      for (const phone of Object.values(phones)) {
        await cleanupByPhone(phone).catch(() => undefined);
      }
      await cleanupZones(zoneIds);
    }
  });

  it('settings rejects delivery/zone keys', async () => {
    const suffix = `${Date.now().toString().slice(-5)}8`;
    const phone = `0730${suffix}`;
    try {
      const { token } = await adminFixture(phone, `settings${suffix}`);
      for (const key of [
        'delivery.price',
        'delivery.baseFee',
        'delivery.pricingRule',
        'zone.geometry',
        'driver.payRate',
      ]) {
        const response = await request(app.getHttpServer())
          .put(`/api/v1/admin/settings/${key}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ value: '500' });
        expect(response.status).toBe(404);
        expect((response.body as ErrorBody).error.code).toBe(
          'SETTING_NOT_SUPPORTED',
        );
      }
    } finally {
      await cleanupByPhone(phone).catch(() => undefined);
    }
  });
});
