import {
  isCommerceVerticalIconKey,
  normalizeCommerceVerticalName,
  normalizeCommerceVerticalSlug,
} from './commerce-vertical.policy';

describe('commerce-vertical.policy', () => {
  it('allowlists Home icon keys only', () => {
    expect(isCommerceVerticalIconKey('restaurant')).toBe(true);
    expect(isCommerceVerticalIconKey('bakery_dining')).toBe(true);
    expect(isCommerceVerticalIconKey('local_mall')).toBe(true);
    expect(isCommerceVerticalIconKey('medical_services')).toBe(true);
    expect(isCommerceVerticalIconKey('icecream')).toBe(true);
    expect(isCommerceVerticalIconKey('pizza')).toBe(false);
    expect(isCommerceVerticalIconKey('Restaurant')).toBe(false);
  });

  it('normalizes kebab slugs and rejects inferred-looking junk', () => {
    expect(normalizeCommerceVerticalSlug(' Restaurants ')).toBe('restaurants');
    expect(normalizeCommerceVerticalSlug('ice-cream')).toBe('ice-cream');
    expect(normalizeCommerceVerticalSlug('A')).toBeNull();
    expect(normalizeCommerceVerticalSlug('Ice_Cream')).toBeNull();
    expect(normalizeCommerceVerticalSlug('-bad')).toBeNull();
  });

  it('trims display names', () => {
    expect(normalizeCommerceVerticalName('  Restaurants  ')).toBe(
      'Restaurants',
    );
    expect(normalizeCommerceVerticalName('')).toBeNull();
    expect(normalizeCommerceVerticalName('   ')).toBeNull();
  });
});
