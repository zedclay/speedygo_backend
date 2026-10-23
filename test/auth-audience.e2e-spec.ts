import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  assertSafeE2eDatabaseUrl,
  resolveE2eDatabaseUrl,
} from '../src/config/e2e-database-safety';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { PrismaService } from '../src/infrastructure/database/database.module';
import { normalizeIdentifier } from '../src/modules/auth/domain/identity';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { reconcileIsolatedAuthAudienceDb } from '../src/modules/auth/infrastructure/session-audience.schema';
import { TokenService } from '../src/modules/auth/infrastructure/token/token.service';
import { clearFixtureOtpResendCooldown } from './helpers/clear-fixture-otp-cooldown';

type TokenBody = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type ErrorBody = { error: { code: string; message: string } };

type MeBody = {
  account: { id: string; phone: string | null; status: string };
  profiles: {
    hasCustomerProfile: boolean;
    hasDriverProfile: boolean;
    hasAdminProfile: boolean;
    hasMerchantMembership: boolean;
  };
};

type MatrixRow = {
  tokenAudience: string;
  endpoint: string;
  path: string;
  status: number;
  code: string | null;
};

const AUDIENCES = ['CUSTOMER', 'MERCHANT', 'DRIVER', 'ADMIN'] as const;

const PROTECTED = [
  { endpoint: 'customer.me', path: '/api/v1/customer/me', audience: 'CUSTOMER' },
  { endpoint: 'merchant.me', path: '/api/v1/merchant/me', audience: 'MERCHANT' },
  { endpoint: 'driver.me', path: '/api/v1/driver/me', audience: 'DRIVER' },
  { endpoint: 'admin.me', path: '/api/v1/admin/me', audience: 'ADMIN' },
  {
    endpoint: 'admin.orders',
    path: '/api/v1/admin/orders',
    audience: 'ADMIN',
  },
] as const;

const SHARED = [
  { endpoint: 'auth.me', path: '/api/v1/auth/me' },
  { endpoint: 'auth.sessions', path: '/api/v1/auth/sessions' },
] as const;

describe('Auth audience (isolated e2e, enforce on)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let tokens: TokenService;
  const previousEnforce = process.env.AUTH_AUDIENCE_ENFORCE;
  const phone = `0562${Date.now().toString().slice(-6)}`;
  const otpBody = {
    channel: 'PHONE' as const,
    identifier: phone,
    purpose: 'AUTHENTICATE' as const,
  };
  const pairs = new Map<string, TokenBody>();
  const matrix: MatrixRow[] = [];

  beforeAll(async () => {
    process.env.AUTH_AUDIENCE_ENFORCE = 'true';
    const databaseUrl = resolveE2eDatabaseUrl(process.env);
    assertSafeE2eDatabaseUrl(databaseUrl);
    reconcileIsolatedAuthAudienceDb(databaseUrl);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sender = app.get(OTP_SENDER);
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    const evidenceDir = join(
      process.cwd(),
      '../../docs/audits/2026-10-21/AUTH_AUDIENCE_EVIDENCE',
    );
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      join(evidenceDir, 'matrix.json'),
      `${JSON.stringify({ phone, matrix }, null, 2)}\n`,
    );
    await cleanupAccount(phone);
    await app.close();
    if (previousEnforce === undefined) {
      delete process.env.AUTH_AUDIENCE_ENFORCE;
    } else {
      process.env.AUTH_AUDIENCE_ENFORCE = previousEnforce;
    }
  });

  async function cleanupAccount(rawPhone: string) {
    const accounts = prisma.getDb().orm.public.Account;
    const e164 = normalizeIdentifier('PHONE', rawPhone, 'DZ');
    const account = await accounts.where({ phone: e164 }).first();
    if (!account) {
      return;
    }
    const customer = await prisma
      .getDb()
      .orm.public.CustomerProfile.where({ accountId: account.id })
      .first();
    if (customer) {
      await prisma
        .getDb()
        .orm.public.CustomerProfile.where({ id: customer.id })
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
    await accounts.where({ id: account.id }).delete();
  }

  async function otp(audience: string): Promise<TokenBody> {
    await clearFixtureOtpResendCooldown(redis, {
      identifier: phone,
      channel: 'PHONE',
    });
    const requested = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .set('X-SpeedyGo-App', audience)
      .send(otpBody);
    expect(requested.status).toBe(200);
    const verified = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .set('X-SpeedyGo-App', audience)
      .send({
        ...otpBody,
        code: sender.lastCode,
        platform: 'ios',
        appVersion: '1.0.0',
        deviceName: `e2e-${audience}`,
      });
    expect(verified.status).toBe(200);
    return verified.body as TokenBody;
  }

  function aud(accessToken: string): string | undefined {
    const payload = jwt.decode(accessToken);
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }
    const value = (payload as { aud?: unknown }).aud;
    return typeof value === 'string' ? value : undefined;
  }

  function countProfiles(accountId: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        accountId,
      )
    ) {
      throw new Error('refused: accountId is not a UUID');
    }
    const url = resolveE2eDatabaseUrl(process.env);
    const parsed = new URL(url);
    parsed.searchParams.delete('schema');
    const scalar = (sql: string) =>
      execSync('psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "$SQL"', {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: parsed.toString(), SQL: sql },
        timeout: 10_000,
        shell: '/bin/bash',
      }).trim();
    return {
      drivers: Number(
        scalar(
          `SELECT count(*)::text FROM driver_profiles WHERE account_id = '${accountId}'::uuid`,
        ),
      ),
      customers: Number(
        scalar(
          `SELECT count(*)::text FROM customer_profiles WHERE account_id = '${accountId}'::uuid`,
        ),
      ),
    };
  }

  it('rejects missing, invalid, and request/verify audience mismatch on OTP', async () => {
    const server = app.getHttpServer();
    const missing = await request(server)
      .post('/api/v1/auth/otp/request')
      .send(otpBody);
    expect(missing.status).toBe(400);
    expect((missing.body as ErrorBody).error.code).toBe(
      'AUTH_APP_AUDIENCE_REQUIRED',
    );

    const invalid = await request(server)
      .post('/api/v1/auth/otp/request')
      .set('X-SpeedyGo-App', 'web')
      .send(otpBody);
    expect(invalid.status).toBe(400);
    expect((invalid.body as ErrorBody).error.code).toBe(
      'AUTH_APP_AUDIENCE_REQUIRED',
    );

    await clearFixtureOtpResendCooldown(redis, {
      identifier: phone,
      channel: 'PHONE',
    });
    const requested = await request(server)
      .post('/api/v1/auth/otp/request')
      .set('X-SpeedyGo-App', 'CUSTOMER')
      .send(otpBody);
    expect(requested.status).toBe(200);
    const mismatched = await request(server)
      .post('/api/v1/auth/otp/verify')
      .set('X-SpeedyGo-App', 'DRIVER')
      .send({
        ...otpBody,
        code: sender.lastCode,
        platform: 'ios',
        appVersion: '1.0.0',
      });
    expect(mismatched.status).toBe(401);
    expect((mismatched.body as ErrorBody).error.code).toMatch(/AUTH_/);
  });

  it('records the four-audience matrix and restores via /auth/me', async () => {
    const server = app.getHttpServer();
    for (const audience of AUDIENCES) {
      const pair = await otp(audience);
      expect(aud(pair.accessToken)).toBe(audience);
      pairs.set(audience, pair);
    }

    const customerClaims = tokens.verifyAccessToken(
      pairs.get('CUSTOMER')!.accessToken,
    );
    const me = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${pairs.get('CUSTOMER')!.accessToken}`);
    expect(me.status).toBe(200);
    const meBody = me.body as MeBody;
    expect(meBody.account.id).toBe(customerClaims.sub);
    expect(meBody.profiles.hasCustomerProfile).toBe(false);
    expect(meBody.profiles.hasDriverProfile).toBe(false);
    expect(meBody.profiles.hasAdminProfile).toBe(false);
    expect(meBody.profiles.hasMerchantMembership).toBe(false);
    expect(countProfiles(customerClaims.sub)).toEqual({
      drivers: 0,
      customers: 0,
    });

    for (const audience of AUDIENCES) {
      const access = pairs.get(audience)!.accessToken;
      for (const target of PROTECTED) {
        const response = await request(server)
          .get(target.path)
          .set('Authorization', `Bearer ${access}`);
        const code =
          (response.body as ErrorBody)?.error?.code ??
          (response.status === 200 ? null : 'UNKNOWN');
        matrix.push({
          tokenAudience: audience,
          endpoint: target.endpoint,
          path: target.path,
          status: response.status,
          code,
        });
        if (audience === target.audience) {
          if (
            target.endpoint === 'admin.me' ||
            target.endpoint === 'admin.orders'
          ) {
            expect(response.status).toBe(403);
            expect(code).not.toBe('AUTH_AUDIENCE_MISMATCH');
            expect(['ADMIN_PROFILE_REQUIRED', 'AUTH_FORBIDDEN']).toContain(
              code,
            );
          } else {
            expect(response.status).toBe(200);
          }
        } else {
          expect(response.status).toBe(403);
          expect(code).toBe('AUTH_AUDIENCE_MISMATCH');
        }
      }
      for (const target of SHARED) {
        const response = await request(server)
          .get(target.path)
          .set('Authorization', `Bearer ${access}`);
        const code =
          (response.body as ErrorBody)?.error?.code ??
          (response.status === 200 ? null : 'UNKNOWN');
        matrix.push({
          tokenAudience: audience,
          endpoint: target.endpoint,
          path: target.path,
          status: response.status,
          code,
        });
        expect(response.status).toBe(200);
      }
    }

    const rotated = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: pairs.get('CUSTOMER')!.refreshToken });
    expect(rotated.status).toBe(200);
    const rotatedTokens = rotated.body as TokenBody;
    expect(aud(rotatedTokens.accessToken)).toBe('CUSTOMER');
    pairs.set('CUSTOMER', rotatedTokens);
    const restoredAfterRefresh = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotatedTokens.accessToken}`);
    expect(restoredAfterRefresh.status).toBe(200);

    const claims = tokens.verifyAccessToken(rotatedTokens.accessToken);
    const legacyJwt = tokens.signAccessToken(claims.sub, claims.sid);
    const legacy = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${legacyJwt}`);
    expect(legacy.status).toBe(401);
    expect((legacy.body as ErrorBody).error.code).toBe(
      'AUTH_AUDIENCE_LEGACY_REJECTED',
    );
  });

  it('refuses POST /auth/refresh for a NULL-audience session when enforcement is on', async () => {
    const server = app.getHttpServer();
    const merchant = pairs.get('MERCHANT')!;
    const { sessionId } = tokens.parseRefreshToken(merchant.refreshToken);
    const presentedHash = tokens.hashRefreshToken(merchant.refreshToken);
    const db = prisma.getDb();
    const clearPlan = db.raw
      .sql`
        UPDATE sessions
        SET auth_audience = NULL
        WHERE id = ${sessionId}::uuid
        RETURNING id, refresh_token_hash
      `
      .returnsRow({
        id: 'pg/uuid@1',
        refresh_token_hash: 'pg/text@1',
      })
      .build();
    const cleared = await db.runtime().query(clearPlan);
    expect(cleared).toHaveLength(1);
    expect(cleared[0]?.refresh_token_hash).toBe(presentedHash);

    const refused = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: merchant.refreshToken });
    expect(refused.status).toBe(401);
    expect((refused.body as ErrorBody).error.code).toBe(
      'AUTH_AUDIENCE_LEGACY_REJECTED',
    );
    expect(
      (refused.body as { accessToken?: unknown }).accessToken,
    ).toBeUndefined();

    const retry = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: merchant.refreshToken });
    expect(retry.status).toBe(401);
    expect((retry.body as ErrorBody).error.code).toBe(
      'AUTH_AUDIENCE_LEGACY_REJECTED',
    );

    const hashPlan = db.raw
      .sql`
        SELECT refresh_token_hash
        FROM sessions
        WHERE id = ${sessionId}::uuid
      `
      .returnsRow({ refresh_token_hash: 'pg/text@1' })
      .build();
    const hashes = await db.runtime().query(hashPlan);
    expect(hashes[0]?.refresh_token_hash).toBe(presentedHash);
  });

  it('keeps audience checks independent of profiles and logout-all account-wide', async () => {
    const server = app.getHttpServer();
    const customer = pairs.get('CUSTOMER');
    const driver = pairs.get('DRIVER');
    expect(customer).toBeDefined();
    expect(driver).toBeDefined();

    const created = await request(server)
      .post('/api/v1/customer/profile')
      .set('Authorization', `Bearer ${customer!.accessToken}`)
      .send({ fullName: 'Audience Matrix' });
    expect(created.status).toBe(201);

    const customerMe = await request(server)
      .get('/api/v1/customer/me')
      .set('Authorization', `Bearer ${customer!.accessToken}`);
    expect(customerMe.status).toBe(200);
    expect(
      (customerMe.body as { customerProfileExists: boolean })
        .customerProfileExists,
    ).toBe(true);

    const driverOnCustomer = await request(server)
      .get('/api/v1/customer/me')
      .set('Authorization', `Bearer ${driver!.accessToken}`);
    expect(driverOnCustomer.status).toBe(403);
    expect((driverOnCustomer.body as ErrorBody).error.code).toBe(
      'AUTH_AUDIENCE_MISMATCH',
    );

    const driverMe = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${driver!.accessToken}`);
    expect(driverMe.status).toBe(200);
    expect((driverMe.body as MeBody).profiles.hasDriverProfile).toBe(false);
    expect((driverMe.body as MeBody).profiles.hasCustomerProfile).toBe(true);

    const driverLogout = await request(server)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${driver!.accessToken}`);
    expect(driverLogout.status).toBe(200);
    const driverRefreshDead = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: driver!.refreshToken });
    expect(driverRefreshDead.status).toBe(401);
    const customerRefreshStill = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: customer!.refreshToken });
    expect(customerRefreshStill.status).toBe(200);
    const stillCustomer = customerRefreshStill.body as TokenBody;
    expect(aud(stillCustomer.accessToken)).toBe('CUSTOMER');

    const merchant = pairs.get('MERCHANT')!;
    const logoutAll = await request(server)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${stillCustomer.accessToken}`);
    expect(logoutAll.status).toBe(200);
    const customerAfterAll = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: stillCustomer.refreshToken });
    expect(customerAfterAll.status).toBe(401);
    const merchantAfterAll = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: merchant.refreshToken });
    expect(merchantAfterAll.status).toBe(401);
  });
});
