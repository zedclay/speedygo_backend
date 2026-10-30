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
  /** Account.status ACTIVE↔SUSPENDED for a CustomerProfile’s Account — not implied by customers.read. */
  CUSTOMERS_SUSPEND: 'customers.suspend',
  /** Create CustomerInternalNote — not implied by customers.read or customers.suspend. */
  CUSTOMERS_NOTES_MANAGE: 'customers.notes.manage',
  ORDERS_READ: 'orders.read',
  /** Admin offer-only driver assign (Matching OFFERED) — not implied by orders.read. */
  ORDERS_ASSIGN: 'orders.assign',
  /** Admin early-window Order cancel — not implied by orders.read or orders.assign. */
  ORDERS_CANCEL: 'orders.cancel',
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
  /** Safe allowlisted platform settings read (Settings Foundation v1.0). */
  SETTINGS_READ: 'settings.read',
  /** Allowlisted platform settings mutation — not implied by settings.read. */
  SETTINGS_MANAGE: 'settings.manage',
  /** Admin Delivery Zones + Pricing APIs v1.0. */
  DELIVERY_ZONES_READ: 'delivery.zones.read',
  DELIVERY_ZONES_MANAGE: 'delivery.zones.manage',
  DELIVERY_PRICING_READ: 'delivery.pricing.read',
  DELIVERY_PRICING_MANAGE: 'delivery.pricing.manage',
  COMMERCE_VERTICALS_READ: 'commerce.verticals.read',
  COMMERCE_VERTICALS_MANAGE: 'commerce.verticals.manage',
  STOREFRONT_COVERS_MANAGE: 'storefront.covers.manage',
  PRODUCT_IMAGES_MANAGE: 'product.images.manage',
  /** Admin RBAC Management v1.0 — AdminProfile list/detail. */
  ADMINS_READ: 'admins.read',
  /** Create/update AdminProfile + Account.status (not roles catalogue). */
  ADMINS_MANAGE: 'admins.manage',
  /** Role list/detail + Permission catalogue read. */
  ROLES_READ: 'roles.read',
  /** Create/update Role + replace RolePermission set. */
  ROLES_MANAGE: 'roles.manage',
} as const);

export type AdminPermissionCode =
  (typeof ADMIN_PERMISSIONS)[keyof typeof ADMIN_PERMISSIONS];

export const ADMIN_PERMISSION_CODES: readonly AdminPermissionCode[] =
  Object.freeze(Object.values(ADMIN_PERMISSIONS));
