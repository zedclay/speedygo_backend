/** Deterministic IDs for the review-catalog fixture namespace only. */
export const NS = '0d00c071-d000-7000-8000-';

export function fid(suffix12) {
  if (!/^[0-9a-f]{12}$/.test(suffix12)) {
    throw new Error(`Fixture suffix must be 12 lowercase hex chars: ${suffix12}`);
  }
  return `${NS}${suffix12}`;
}

export const pad2 = (n) => String(n).padStart(2, '0');

export const OWNER_ACCOUNT_ID = fid('000000000001');
export const REVIEWER_ACCOUNT_ID = fid('0000000000c1');
export const REVIEWER_PROFILE_ID = fid('0000000000c2');

export const OWNER_PHONE = '+213550000071';
export const REVIEWER_PHONE = '+213550000072';

export const VERTICAL_BAKERIES_ID = fid('00000000a001');
export const VERTICAL_PHARMACIES_ID = fid('00000000a002');

/** Existing platform verticals (not owned by this fixture; referenced only). */
export const EXISTING_VERTICALS = {
  restaurants: '8dee7495-963d-40dc-8818-2f97ba52f38c',
  desserts: '6b827fce-d8f2-4082-960f-8508b7550241',
  groceries: 'fc3a61a7-c681-441b-b0d4-22a888920e9f',
};

export function merchantId(n) {
  return fid(`0000000100${pad2(n)}`);
}
export function branchId(n) {
  return fid(`0000000110${pad2(n)}`);
}
export function classificationId(n) {
  return fid(`0000000120${pad2(n)}`);
}
export function scheduleId(n) {
  return fid(`0000000130${pad2(n)}`);
}
export function memberId(n) {
  return fid(`0000000140${pad2(n)}`);
}
export function intervalId(n, day, sort = 0) {
  return fid(`00000015${pad2(n)}${day}${sort}`);
}
export function categoryId(n, c) {
  return fid(`00000002${pad2(n)}${pad2(c)}`);
}
export function productId(n, p) {
  return fid(`00000003${pad2(n)}${pad2(p)}`);
}
export function optionGroupId(n, p, g) {
  return fid(`0000004${pad2(n)}${pad2(p)}${g}`);
}
export function optionId(n, p, g, o) {
  return fid(`000005${pad2(n)}${pad2(p)}${g}${o}`);
}

export const FIXTURE_ID_PREFIX = NS;
export const STOREFRONT_COUNT = 10;
