/**
 * Isolated apply of structured address-detail columns.
 * Targets 127.0.0.1:5433/speedygo_test only. Never speedygo_dev / FX / rehearsal.
 * Leaves columns in place (data-preserving disable). Does not drop saved details.
 */
import {
  assertSafeE2eDatabaseUrl,
  resolveE2eDatabaseUrl,
} from '../../../config/e2e-database-safety';
import {
  applyAddressDetailsSchema,
  describeAddressDetailColumns,
} from './address-details.schema';

process.env.DATABASE_URL = resolveE2eDatabaseUrl({
  E2E_DATABASE_URL: process.env.E2E_DATABASE_URL,
});
assertSafeE2eDatabaseUrl(process.env.DATABASE_URL);

describe('address detail columns (isolated speedygo_test)', () => {
  const url = process.env.DATABASE_URL as string;

  it('refuses operational database URLs before psql', () => {
    expect(() =>
      applyAddressDetailsSchema(
        'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_dev?schema=public',
      ),
    ).toThrow(/speedygo_dev/);
    expect(() =>
      applyAddressDetailsSchema(
        'postgresql://speedygo:speedygo@127.0.0.1:5432/speedygo_test?schema=public',
      ),
    ).toThrow(/5432/);
  });

  it('adds nullable varchar columns on addresses and order snapshots', () => {
    applyAddressDetailsSchema(url);
    const addresses = describeAddressDetailColumns(url, 'addresses');
    expect(addresses.building).toEqual({ present: true, maxLength: '64' });
    expect(addresses.floor).toEqual({ present: true, maxLength: '32' });
    expect(addresses.entrance).toEqual({ present: true, maxLength: '64' });
    expect(addresses.landmark).toEqual({ present: true, maxLength: '128' });
    const snapshots = describeAddressDetailColumns(
      url,
      'order_delivery_address_snapshots',
    );
    expect(snapshots.building).toEqual({ present: true, maxLength: '64' });
    expect(snapshots.floor).toEqual({ present: true, maxLength: '32' });
    expect(snapshots.entrance).toEqual({ present: true, maxLength: '64' });
    expect(snapshots.landmark).toEqual({ present: true, maxLength: '128' });
  });
});
