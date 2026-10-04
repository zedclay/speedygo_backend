/**
 * Shared Algeria catalogue fixture for Merchant branch HTTP creates in e2e.
 * Catalogue must already be imported into speedygo_test (`pnpm geo:import-algeria`
 * with GEO_IMPORT_DATABASE=speedygo_test).
 */
export const E2E_BRANCH_GEO = {
  wilayaCode: '16',
  communeId: 556,
} as const;

export function withBranchGeo<T extends Record<string, unknown>>(
  body: T,
): T & typeof E2E_BRANCH_GEO {
  return { ...body, ...E2E_BRANCH_GEO };
}
