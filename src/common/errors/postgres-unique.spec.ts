import { isPostgresUniqueViolation } from './postgres-unique';

describe('isPostgresUniqueViolation', () => {
  it('detects sqlState 23505 on nested causes', () => {
    expect(
      isPostgresUniqueViolation({
        cause: { code: '23505' },
      }),
    ).toBe(true);
    expect(isPostgresUniqueViolation({ sqlState: '23505' })).toBe(true);
    expect(isPostgresUniqueViolation(new Error('nope'))).toBe(false);
  });
});
