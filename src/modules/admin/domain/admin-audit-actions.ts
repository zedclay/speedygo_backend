/** Deterministic AuditLog.action strings for Admin Foundation v1.0. */
export const ADMIN_AUDIT_ACTIONS = Object.freeze({
  MERCHANT_VERIFICATION_APPROVE: 'merchant.verification.approve',
  MERCHANT_VERIFICATION_REJECT: 'merchant.verification.reject',
  MERCHANT_SUSPEND: 'merchant.suspend',
  DRIVER_VERIFICATION_APPROVE: 'driver.verification.approve',
  DRIVER_VERIFICATION_REJECT: 'driver.verification.reject',
  DRIVER_SUSPEND: 'driver.suspend',
  REFUND_CREATE: 'refund.create',
  REFUND_APPROVE: 'refund.approve',
  REFUND_REJECT: 'refund.reject',
  REFUND_CONFIRM_MANUAL: 'refund.confirm_manual',
  COD_REMITTANCE_CONFIRM: 'cod.remittance.confirm',
  SETTLEMENT_OPEN_DRAFT: 'settlement.open_draft',
  SETTLEMENT_BUILD_SALE_LINES: 'settlement.build_sale_lines',
  SETTLEMENT_ATTACH_REFUND_LIABILITY: 'settlement.attach_refund_liability',
  SETTLEMENT_FINALIZE: 'settlement.finalize',
  PROMOTION_CREATE: 'promotion.create',
  PROMOTION_ACTIVATE: 'promotion.activate',
  PROMOTION_DEACTIVATE: 'promotion.deactivate',
  SUPPORT_ASSIGN: 'support.assign',
  SUPPORT_STATUS_CHANGE: 'support.status_change',
  SUPPORT_PRIORITY_CHANGE: 'support.priority_change',
  SUPPORT_INTERNAL_NOTE: 'support.internal_note',
} as const);

export type AdminAuditAction =
  (typeof ADMIN_AUDIT_ACTIONS)[keyof typeof ADMIN_AUDIT_ACTIONS];

/** Deterministic AuditLog.targetType strings. */
export const ADMIN_AUDIT_TARGET_TYPES = Object.freeze({
  MERCHANT: 'Merchant',
  DRIVER: 'DriverProfile',
  REFUND: 'Refund',
  COD_REMITTANCE: 'CodRemittance',
  MERCHANT_SETTLEMENT: 'MerchantSettlement',
  PROMOTION: 'Promotion',
  SUPPORT_TICKET: 'SupportTicket',
} as const);

export type AdminAuditTargetType =
  (typeof ADMIN_AUDIT_TARGET_TYPES)[keyof typeof ADMIN_AUDIT_TARGET_TYPES];
