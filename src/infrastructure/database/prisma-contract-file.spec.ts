import {
  assertAudiencePrismaDatabase,
  selectPrismaContractFile,
} from './prisma-contract-file';

describe('prisma contract file selection', () => {
  it('keeps shared money on contract.dzd.json', () => {
    expect(selectPrismaContractFile({ MONEY_PRISMA_DECIMAL: '1' })).toBe(
      'contract.dzd.json',
    );
  });

  it('keeps isolated audience-only on contract.audience.json', () => {
    expect(selectPrismaContractFile({ AUTH_AUDIENCE_PRISMA: '1' })).toBe(
      'contract.audience.json',
    );
  });

  it('selects combined JSON only when both flags are set', () => {
    expect(
      selectPrismaContractFile({
        AUTH_AUDIENCE_PRISMA: '1',
        MONEY_PRISMA_DECIMAL: '1',
      }),
    ).toBe('contract.dzd.audience.json');
  });

  it('defaults to shared BigInt JSON', () => {
    expect(selectPrismaContractFile({})).toBe('contract.json');
  });

  it('refuses shared, FX, and rehearsal names', () => {
    const env = { AUTH_AUDIENCE_PRISMA: '1' };
    expect(() =>
      assertAudiencePrismaDatabase(
        'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_dev',
        env,
      ),
    ).toThrow(/speedygo_dev/);
    expect(() =>
      assertAudiencePrismaDatabase(
        'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_parity_fx',
        env,
      ),
    ).toThrow(/speedygo_parity_fx/);
    expect(() =>
      assertAudiencePrismaDatabase(
        'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_money_migrate_rehearsal',
        env,
      ),
    ).toThrow(/speedygo_money_migrate_rehearsal/);
  });

  it('allows speedygo_test for audience-only and combined *isolated_money', () => {
    assertAudiencePrismaDatabase(
      'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_test',
      { AUTH_AUDIENCE_PRISMA: '1' },
    );
    assertAudiencePrismaDatabase(
      'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_audience_isolated_money',
      { AUTH_AUDIENCE_PRISMA: '1', MONEY_PRISMA_DECIMAL: '1' },
    );
  });

  it('refuses combined flags on speedygo_test and rehearsal', () => {
    const combined = {
      AUTH_AUDIENCE_PRISMA: '1',
      MONEY_PRISMA_DECIMAL: '1',
    };
    expect(() =>
      assertAudiencePrismaDatabase(
        'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_test',
        combined,
      ),
    ).toThrow(/speedygo_test/);
    expect(() =>
      assertAudiencePrismaDatabase(
        'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_money_migrate_rehearsal',
        combined,
      ),
    ).toThrow(/speedygo_money_migrate_rehearsal/);
  });
});
