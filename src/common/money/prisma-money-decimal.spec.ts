import {
  isDecimalPrismaStorage,
  loadStoredCentimes,
  persistStoredMoney,
} from './prisma-money-decimal';

describe('prisma Decimal persistence adapter', () => {
  const prev = process.env['MONEY_PRISMA_DECIMAL'];

  afterEach(() => {
    if (prev === undefined) {
      delete process.env['MONEY_PRISMA_DECIMAL'];
    } else {
      process.env['MONEY_PRISMA_DECIMAL'] = prev;
    }
  });

  it('legacy mode persists bigint centimes', () => {
    delete process.env['MONEY_PRISMA_DECIMAL'];
    expect(isDecimalPrismaStorage()).toBe(false);
    expect(persistStoredMoney(65000)).toBe(65000n);
    expect(loadStoredCentimes(65000n)).toBe(65000n);
  });

  it('decimal mode persists NUMERIC strings and loads centimes', () => {
    process.env['MONEY_PRISMA_DECIMAL'] = '1';
    expect(persistStoredMoney(65000n)).toBe('650.00' as unknown as bigint);
    expect(loadStoredCentimes('650.00')).toBe(65000n);
    expect(loadStoredCentimes('150.00')).toBe(15000n);
    expect(loadStoredCentimes('45000')).toBe(45000n);
  });
});
