export const COMMERCE_VERTICAL_ICON_KEYS = [
  'restaurant',
  'bakery_dining',
  'local_mall',
  'medical_services',
  'icecream',
] as const;

export type CommerceVerticalIconKey =
  (typeof COMMERCE_VERTICAL_ICON_KEYS)[number];

export const COMMERCE_VERTICAL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const COMMERCE_VERTICAL_SLUG_MIN = 2;
export const COMMERCE_VERTICAL_SLUG_MAX = 64;
export const COMMERCE_VERTICAL_NAME_MAX = 255;

export function isCommerceVerticalIconKey(
  value: string,
): value is CommerceVerticalIconKey {
  return (COMMERCE_VERTICAL_ICON_KEYS as readonly string[]).includes(value);
}

export function normalizeCommerceVerticalSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase();
  if (
    slug.length < COMMERCE_VERTICAL_SLUG_MIN ||
    slug.length > COMMERCE_VERTICAL_SLUG_MAX
  ) {
    return null;
  }
  if (!COMMERCE_VERTICAL_SLUG_PATTERN.test(slug)) {
    return null;
  }
  return slug;
}

export function normalizeCommerceVerticalName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || name.length > COMMERCE_VERTICAL_NAME_MAX) {
    return null;
  }
  return name;
}
