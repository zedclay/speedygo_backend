/**
 * Application permission code vocabulary for Admin Foundation v1.0.
 * Codes are DB-authoritative VARCHAR on Permission.code — do not invent schema.
 * E2E / ops seed Permission + RolePermission rows to match these constants.
 */
export const ADMIN_PERMISSIONS = Object.freeze({
  MERCHANTS_READ: 'merchants.read',
  MERCHANTS_VERIFY: 'merchants.verify',
  MERCHANTS_SUSPEND: 'merchants.suspend',
  DRIVERS_READ: 'drivers.read',
  DRIVERS_VERIFY: 'drivers.verify',
  DRIVERS_SUSPEND: 'drivers.suspend',
  CUSTOMERS_READ: 'customers.read',
  ORDERS_READ: 'orders.read',
  PAYMENTS_READ: 'payments.read',
  REFUNDS_READ: 'refunds.read',
  REFUNDS_MANAGE: 'refunds.manage',
  COD_READ: 'cod.read',
  COD_REMITTANCE_CONFIRM: 'cod.remittance.confirm',
  SETTLEMENTS_READ: 'settlements.read',
  SETTLEMENTS_MANAGE: 'settlements.manage',
  PROMOTIONS_READ: 'promotions.read',
  PROMOTIONS_MANAGE: 'promotions.manage',
  LEDGER_READ: 'ledger.read',
  AUDIT_READ: 'audit.read',
  SUPPORT_READ: 'support.read',
  SUPPORT_MANAGE: 'support.manage',
  /** Operational / non-sensitive Admin reports (Reports Foundation v1.0). */
  REPORTS_READ: 'reports.read',
  /** Financial Admin reports — not implied by reports.read. */
  REPORTS_FINANCE_READ: 'reports.finance.read',
} as const);

export type AdminPermissionCode =
  (typeof ADMIN_PERMISSIONS)[keyof typeof ADMIN_PERMISSIONS];

export const ADMIN_PERMISSION_CODES: readonly AdminPermissionCode[] =
  Object.freeze(Object.values(ADMIN_PERMISSIONS));
