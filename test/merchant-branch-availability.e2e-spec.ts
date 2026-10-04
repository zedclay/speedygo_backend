/**
 * Focused e2e: Merchant Branch availability override GET/PUT + Checkout/Order gates.
 * Uses TestOtpSender. Document NOT RUN in live report if OTP/Prisma bootstrap fails.
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
  pgBigInt,
  pgNow,
  pgTimestamptz,
  pgVarchar,
} from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { CHECKOUT_CLOCK } from '../src/modules/checkout/domain/checkout.clock';
import { ISO_DAYS_OF_WEEK } from '../src/modules/merchants/domain/opening-hours.constants';
import { deactivateAllDeliveryZones } from './helpers/sanitize-delivery-zones';
import { deleteBranchOpeningHours } from './helpers/ensure-branch-opening-hours';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';

type TokenBody = { accessToken: string };
type ErrorBody = {
  error: {
    code: string;
    message: string;
    availability?: { version?: number | null; availabilityMode?: string };
  };
};
type AuthMeBody = { account: { id: string; phone: string } };
type MembershipBody = { merchantId: string };
type BranchBody = { id: string };
type CategoryBody = { id: string };
type ProductBody = { id: string };
type AddressBody = { id: string };
type AvailabilityBody = {
  branchId: string;
  availabilityMode: string;
  effectiveMode: string;
  hoursConfigured: boolean;
  isOpenNow: boolean;
  acceptingOrders: boolean;
  temporaryExpired: boolean;
  outsideWeeklyHours: boolean;
  closedUntil: string | null;
  nextOpenAt: string | null;
  version: number | null;
};

const INSIDE: [number, number] = [36.75, 3.05];
const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

function weeklyDays(
  intervalsByDay: Partial<
    Record<number, Array<{ opens: string; closes: string }>>
  > = {},
) {
  return ISO_DAYS_OF_WEEK.map((dayOfWeek) => ({
    dayOfWeek,
    intervals: intervalsByDay[dayOfWeek] ?? [],
  }));
}

describe('Merchant branch availability (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let fixedNow: Date | null = null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CHECKOUT_CLOCK)
      .useValue({
        now: () => fixedNow ?? new Date(),
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sender = app.get(OTP_SENDER);
    prisma = app.get(PrismaService);
    await deactivateAllDeliveryZones(prisma);
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
        deviceName: 'availability-e2e',
      });
    expect(verified.status).toBe(200);
    return (verified.body as TokenBody).accessToken;
  }

  async function authMe(token: string): Promise<AuthMeBody['account']> {
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    return (me.body as AuthMeBody).account;
  }

  async function approveMerchant(merchantId: string): Promise<void> {
    await prisma
      .getDb()
      .orm.public.Merchant.where({ id: merchantId })
      .update({
        status: pgVarchar<64>('ACTIVE'),
        verifiedAt: pgNow(),
        updatedAt: pgNow(),
      });
  }

  async function deleteAvailability(branchId: string): Promise<void> {
    await prisma
      .getDb()
      .orm.public.MerchantBranchAvailabilityOverride.where({ branchId })
      .delete();
  }

  async function cleanupAccount(phoneE164: string): Promise<void> {
    const account = await prisma
      .getDb()
      .orm.public.Account.where({ phone: phoneE164 })
      .first();
    if (!account) return;
    const members = await prisma
      .getDb()
      .orm.public.MerchantMember.where({ accountId: account.id })
      .all();
    for (const member of members) {
      const branches = await prisma
        .getDb()
        .orm.public.MerchantBranch.where({ merchantId: member.merchantId })
        .all();
      for (const branch of branches) {
        await deleteAvailability(branch.id);
        await deleteBranchOpeningHours(prisma, branch.id);
        const branchCarts = await prisma
          .getDb()
          .orm.public.Cart.where({ merchantBranchId: branch.id })
          .all();
        for (const cart of branchCarts) {
          await prisma.getDb().orm.public.Cart.where({ id: cart.id }).delete();
        }
        const products = await prisma
          .getDb()
          .orm.public.Product.where({ merchantBranchId: branch.id })
          .all();
        for (const product of products) {
          await prisma
            .getDb()
            .orm.public.Product.where({ id: product.id })
            .delete();
        }
        const categories = await prisma
          .getDb()
          .orm.public.Category.where({ merchantBranchId: branch.id })
          .all();
        for (const category of categories) {
          await prisma
            .getDb()
            .orm.public.Category.where({ id: category.id })
            .delete();
        }
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
    const profile = await prisma
      .getDb()
      .orm.public.CustomerProfile.where({ accountId: account.id })
      .first();
    if (profile) {
      const carts = await prisma
        .getDb()
        .orm.public.Cart.where({ customerId: profile.id })
        .all();
      for (const cart of carts) {
        await prisma.getDb().orm.public.Cart.where({ id: cart.id }).delete();
      }
      const addresses = await prisma
        .getDb()
        .orm.public.Address.where({ customerId: profile.id })
        .all();
      for (const address of addresses) {
        await prisma
          .getDb()
          .orm.public.Address.where({ id: address.id })
          .delete();
      }
      await prisma
        .getDb()
        .orm.public.CustomerProfile.where({ id: profile.id })
        .delete();
    }
    const sessions = await prisma
      .getDb()
      .orm.public.Session.where({ accountId: account.id })
      .all();
    for (const session of sessions) {
      await prisma.getDb().orm.public.Session.where({ id: session.id }).delete();
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

  it('GET/PUT override, conflict payload, FORCE_CLOSED blocks checkout, expired temp follows schedule without write', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0581${suffix}`,
      owner: `0582${suffix}`,
    };
    const e164: string[] = [];
    let zoneId: string | null = null;
    // Mon 11:00 Africa/Algiers
    fixedNow = new Date('2024-01-15T10:00:00.000Z');

    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenOwner = await authenticate(phones.owner);
      const accountOwner = await authMe(tokenOwner);
      e164.push((await authMe(tokenCustomer)).phone, accountOwner.phone);

      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'Avail Customer' });

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Avail Cafe' });
      expect(merchant.status).toBe(201);
      const merchantId = (merchant.body as MembershipBody).merchantId;

      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'Main',
          phone: '0550123499',
          addressText: 'Street',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
          wilayaCode: '16',
          communeId: 556,
        });
      expect(branch.status).toBe(201);
      const branchId = (branch.body as BranchBody).id;
      await approveMerchant(merchantId);

      const hoursPut = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/opening-hours`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          expectedVersion: 0,
          days: weeklyDays({ 1: [{ opens: '09:00', closes: '17:00' }] }),
        });
      expect(hoursPut.status).toBe(200);

      const empty = await request(server)
        .get(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/availability`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(empty.status).toBe(200);
      const emptyBody = empty.body as AvailabilityBody;
      expect(emptyBody.availabilityMode).toBe('FOLLOW_SCHEDULE');
      expect(emptyBody.effectiveMode).toBe('FOLLOW_SCHEDULE');
      expect(emptyBody.isOpenNow).toBe(true);
      expect(emptyBody.acceptingOrders).toBe(true);
      expect(emptyBody.version).toBeNull();

      const forceClosed = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/availability`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          expectedVersion: 0,
          mode: 'FORCE_CLOSED',
          reasonCode: 'TECHNICAL',
        });
      expect(forceClosed.status).toBe(200);
      const closedBody = forceClosed.body as AvailabilityBody;
      expect(closedBody.availabilityMode).toBe('FORCE_CLOSED');
      expect(closedBody.isOpenNow).toBe(false);
      expect(closedBody.nextOpenAt).toBeNull();
      expect(closedBody.version).toBe(1);

      const conflict = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/availability`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          expectedVersion: 0,
          mode: 'FOLLOW_SCHEDULE',
        });
      expect(conflict.status).toBe(409);
      const conflictErr = conflict.body as ErrorBody;
      expect(conflictErr.error.code).toBe('AVAILABILITY_VERSION_CONFLICT');
      expect(conflictErr.error.availability?.version).toBe(1);
      expect(conflictErr.error.availability?.availabilityMode).toBe(
        'FORCE_CLOSED',
      );

      const pastTemp = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/availability`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          expectedVersion: 1,
          mode: 'TEMPORARY_CLOSED',
          closedUntil: '2024-01-15T09:00:00.000Z',
          reasonCode: 'LUNCH_BREAK',
        });
      expect(pastTemp.status).toBe(400);
      expect((pastTemp.body as ErrorBody).error.code).toBe(
        'AVAILABILITY_INVALID',
      );

      const temp = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/availability`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          expectedVersion: 1,
          mode: 'TEMPORARY_CLOSED',
          closedUntil: '2024-01-15T14:00:00.000Z',
          reasonCode: 'PEAK_KITCHEN',
          customerMessage: 'Complet 30 min',
        });
      expect(temp.status).toBe(200);
      const tempBody = temp.body as AvailabilityBody;
      expect(tempBody.availabilityMode).toBe('TEMPORARY_CLOSED');
      expect(tempBody.isOpenNow).toBe(false);
      expect(tempBody.closedUntil).toBe('2024-01-15T14:00:00.000Z');
      expect(tempBody.version).toBe(2);

      // Expire temporary in memory — GET must not write DB.
      fixedNow = new Date('2024-01-15T15:00:00.000Z');
      const versionBefore = (
        await prisma
          .getDb()
          .orm.public.MerchantBranchAvailabilityOverride.where({
            branchId,
          })
          .first()
      )?.version;
      const afterExpiry = await request(server)
        .get(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/availability`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(afterExpiry.status).toBe(200);
      const afterBody = afterExpiry.body as AvailabilityBody;
      expect(afterBody.temporaryExpired).toBe(true);
      expect(afterBody.effectiveMode).toBe('FOLLOW_SCHEDULE');
      // 15:00 UTC = 16:00 Algiers — outside Mon 09–17 → Fermé by hours
      expect(afterBody.isOpenNow).toBe(false);
      const versionAfter = (
        await prisma
          .getDb()
          .orm.public.MerchantBranchAvailabilityOverride.where({
            branchId,
          })
          .first()
      )?.version;
      expect(versionAfter).toBe(versionBefore);

      // Back inside hours with FORCE_CLOSED still in DB as expired temp → open by schedule
      fixedNow = new Date('2024-01-15T10:00:00.000Z');
      // Still expired temp treated as FOLLOW — reopen inside hours
      const insideAgain = await request(server)
        .get(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/availability`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`);
      // Temp still active until 14:00 with fixedNow=10:00
      expect((insideAgain.body as AvailabilityBody).isOpenNow).toBe(false);

      // Force closed again to block checkout
      const force2 = await request(server)
        .put(
          `/api/v1/merchant/${merchantId}/branches/${branchId}/availability`,
        )
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          expectedVersion: 2,
          mode: 'FORCE_CLOSED',
        });
      expect(force2.status).toBe(200);

      const category = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ branchId, name: 'Drinks' });
      const product = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          branchId,
          categoryId: (category.body as CategoryBody).id,
          name: 'Coffee',
          priceMinor: 1000,
        });
      const productId = (product.body as ProductBody).id;

      const address = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          label: 'Home',
          addressText: 'Inside',
          latitude: INSIDE[0],
          longitude: INSIDE[1],
        });
      const addressId = (address.body as AddressBody).id;

      zoneId = createUuidV7();
      const now = pgNow();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Avail zone ${suffix}`),
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[COVERING_RING]],
          srid: 4326,
        },
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      await prisma.getDb().orm.public.DeliveryPricingRule.create({
        id: createUuidV7(),
        zoneId,
        name: pgVarchar<255>('All day'),
        timeBand: 'DAY',
        startLocalTime: null,
        endLocalTime: null,
        customerDeliveryFeeMinor: pgBigInt(500),
        driverRemunerationMinor: pgBigInt(300),
        effectiveFrom: pgTimestamptz('2020-01-01T00:00:00.000Z'),
        effectiveTo: null,
        active: true,
        createdAt: now,
        updatedAt: now,
      });

      await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ productId, quantity: 1 });

      const preview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ addressId });
      expect(preview.status).toBe(400);
      expect((preview.body as ErrorBody).error.code).toBe(
        'CHECKOUT_BRANCH_CLOSED',
      );

      const storefront = await request(server)
        .get(`/api/v1/customer/branches/${branchId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(storefront.status).toBe(200);
      expect(
        (storefront.body as { isOpenNow?: boolean }).isOpenNow,
      ).toBe(false);
    } finally {
      fixedNow = null;
      if (zoneId) {
        const rules = await prisma
          .getDb()
          .orm.public.DeliveryPricingRule.where({ zoneId })
          .all();
        for (const rule of rules) {
          await prisma
            .getDb()
            .orm.public.DeliveryPricingRule.where({ id: rule.id })
            .delete();
        }
        await prisma
          .getDb()
          .orm.public.DeliveryZone.where({ id: zoneId })
          .delete();
      }
      for (const phone of e164) {
        await cleanupAccount(phone);
      }
    }
  });
});
