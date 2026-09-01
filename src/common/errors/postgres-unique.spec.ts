import {
  isPostgresCheckViolation,
  isPostgresForeignKeyViolation,
  isPostgresUniqueViolation,
} from './postgres-unique';

describe('postgres SQLSTATE helpers', () => {
  it('detects unique and foreign-key violations on nested causes', () => {
    expect(
      isPostgresUniqueViolation({
        cause: { code: '23505' },
      }),
    ).toBe(true);
    expect(isPostgresUniqueViolation({ sqlState: '23505' })).toBe(true);
    expect(isPostgresUniqueViolation(new Error('nope'))).toBe(false);
    expect(isPostgresForeignKeyViolation({ sqlState: '23503' })).toBe(true);
    expect(isPostgresForeignKeyViolation({ code: '23505' })).toBe(false);
    expect(isPostgresCheckViolation({ sqlState: '23514' })).toBe(true);
    expect(isPostgresCheckViolation({ code: '23503' })).toBe(false);
  });
});
