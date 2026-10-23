import {
  ADMIN_SEARCH_TYPES,
  adminSearchPhoneDigits,
  isAdminSearchUuid,
  normalizeAdminSearchLimitPerType,
  normalizeAdminSearchQuery,
  parseAdminSearchTypes,
  resolvePermittedSearchTypes,
  stripAdminSearchLikeMetacharacters,
} from './admin-search.policy';

describe('admin-search.policy', () => {
  it('strips LIKE metacharacters (Policy B)', () => {
    expect(stripAdminSearchLikeMetacharacters('ab%c_d\\e')).toBe('abcde');
  });

  it('normalizes query length bounds', () => {
    expect(normalizeAdminSearchQuery('  ab  ')).toBe('ab');
    expect(() => normalizeAdminSearchQuery('a')).toThrow(/at least/);
    expect(() => normalizeAdminSearchQuery('%_%')).toThrow(/at least/);
    expect(() => normalizeAdminSearchQuery('x'.repeat(101))).toThrow(/at most/);
  });

  it('parses and intersects types with permissions', () => {
    expect(parseAdminSearchTypes('customers,orders,nope')).toEqual([
      'customers',
      'orders',
    ]);
    expect(
      resolvePermittedSearchTypes(
        ['customers.read', 'orders.read'],
        ['customers', 'merchants', 'orders'],
      ),
    ).toEqual(['customers', 'orders']);
    expect(resolvePermittedSearchTypes(['audit.read'], null)).toEqual([]);
    expect(resolvePermittedSearchTypes(['customers.read'], null)).toEqual([
      'customers',
    ]);
  });

  it('bounds limitPerType', () => {
    expect(normalizeAdminSearchLimitPerType(undefined)).toBe(8);
    expect(normalizeAdminSearchLimitPerType(100)).toBe(20);
    expect(normalizeAdminSearchLimitPerType(0)).toBe(1);
  });

  it('detects uuid and phone digits', () => {
    expect(
      isAdminSearchUuid('0d00c091-d000-7000-8000-000000000202'),
    ).toBe(true);
    expect(isAdminSearchUuid('not-a-uuid')).toBe(false);
    expect(adminSearchPhoneDigits('+213 550 000 091')).toBe('213550000091');
    expect(adminSearchPhoneDigits('123')).toBeNull();
  });

  it('exposes stable type catalogue', () => {
    expect(ADMIN_SEARCH_TYPES).toContain('support');
  });
});
