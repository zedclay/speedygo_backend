/**
 * Isolated apply/verify/rollback of sessions.auth_audience.
 * Targets 127.0.0.1:5433/speedygo_test only. Never speedygo_dev.
 */
import {
  assertSafeE2eDatabaseUrl,
  resolveE2eDatabaseUrl,
} from '../../../config/e2e-database-safety';
import {
  applySessionAudienceSchema,
  describeSessionAudienceColumn,
  preferredLocaleColumnPresent,
  reconcileIsolatedAuthAudienceDb,
  rollbackSessionAudienceSchema,
} from './session-audience.schema';

process.env.DATABASE_URL = resolveE2eDatabaseUrl({
  E2E_DATABASE_URL: process.env.E2E_DATABASE_URL,
});
assertSafeE2eDatabaseUrl(process.env.DATABASE_URL);

describe('session auth_audience schema (isolated speedygo_test)', () => {
  const url = process.env.DATABASE_URL as string;

  it('refuses operational database URLs before psql', () => {
    expect(() =>
      applySessionAudienceSchema(
        'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_dev?schema=public',
      ),
    ).toThrow(/speedygo_dev/);
    expect(() =>
      applySessionAudienceSchema(
        'postgresql://speedygo:speedygo@127.0.0.1:5432/speedygo_test?schema=public',
      ),
    ).toThrow(/5432/);
  });

  it('applies a nullable audience column, can roll it back, then leaves reconcile in place', () => {
    applySessionAudienceSchema(url);
    const applied = describeSessionAudienceColumn(url);
    expect(applied.present).toBe(true);
    expect(applied.isNullable).toBe('YES');
    expect(applied.maxLength).toBe('16');
    expect(applied.checkDef).toMatch(/CUSTOMER/);
    expect(applied.checkDef).toMatch(/MERCHANT/);
    expect(applied.checkDef).toMatch(/DRIVER/);
    expect(applied.checkDef).toMatch(/ADMIN/);

    rollbackSessionAudienceSchema(url);
    const rolled = describeSessionAudienceColumn(url);
    expect(rolled.present).toBe(false);
    expect(rolled.checkDef).toBeNull();

    reconcileIsolatedAuthAudienceDb(url);
    expect(describeSessionAudienceColumn(url).present).toBe(true);
    expect(preferredLocaleColumnPresent(url)).toBe(true);
  });
});
