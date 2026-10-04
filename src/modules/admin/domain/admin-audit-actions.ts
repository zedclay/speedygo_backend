/** Deterministic AuditLog.action strings for Admin Foundation v1.0. */
export const ADMIN_AUDIT_ACTIONS = Object.freeze({
  MERCHANT_VERIFICATION_APPROVE: 'merchant.verification.approve',
  MERCHANT_VERIFICATION_REJECT: 'merchant.verification.reject',
  MERCHANT_SUSPEND: 'merchant.suspend',
  DRIVER_VERIFICATION_APPROVE: 'driver.verification.approve',
  DRIVER_VERIFICATION_REJECT: 'driver.verification.reject',
  DRIVER_SUSPEND: 'driver.suspend',
  DRIVER_DOCUMENT_READ: 'driver.document.read',
  MERCHANT_DOCUMENT_READ: 'merchant.document.read',
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
  PROMOTION_PUBLISH_DISCOVERY: 'promotion.publish_discovery',
  PROMOTION_HIDE_DISCOVERY: 'promotion.hide_discovery',
  PROMOTION_UPDATE_PRESENTATION: 'promotion.update_presentation',
  SUPPORT_ASSIGN: 'support.assign',
  SUPPORT_STATUS_CHANGE: 'support.status_change',
  SUPPORT_PRIORITY_CHANGE: 'support.priority_change',
  SUPPORT_INTERNAL_NOTE: 'support.internal_note',
  SETTINGS_UPDATE_SUPPORT_CONTACT_EMAIL:
    'settings.update.platform.supportContactEmail',
  SETTINGS_UPDATE_SUPPORT_CONTACT_PHONE:
    'settings.update.platform.supportContactPhone',
  /** Admin Delivery Zones + Pricing APIs v1.0. */
  DELIVERY_ZONE_CREATE: 'delivery.zone.create',
  DELIVERY_ZONE_UPDATE: 'delivery.zone.update',
  DELIVERY_ZONE_ACTIVATE: 'delivery.zone.activate',
  DELIVERY_ZONE_DEACTIVATE: 'delivery.zone.deactivate',
  DELIVERY_PRICING_RULE_CREATE: 'delivery.pricing-rule.create',
  DELIVERY_PRICING_RULE_ACTIVATE: 'delivery.pricing-rule.activate',
  DELIVERY_PRICING_RULE_DEACTIVATE: 'delivery.pricing-rule.deactivate',
  COMMERCE_VERTICAL_CREATE: 'commerce.vertical.create',
  COMMERCE_VERTICAL_UPDATE: 'commerce.vertical.update',
  COMMERCE_VERTICAL_ACTIVATE: 'commerce.vertical.activate',
  COMMERCE_VERTICAL_DEACTIVATE: 'commerce.vertical.deactivate',
  COMMERCE_VERTICAL_ASSIGN_BRANCH: 'commerce.vertical.assign-branch',
  COMMERCE_VERTICAL_UNASSIGN_BRANCH: 'commerce.vertical.unassign-branch',
  STOREFRONT_COVER_BIND: 'storefront.cover.bind',
  STOREFRONT_COVER_DELETE: 'storefront.cover.delete',
  PRODUCT_IMAGE_BIND: 'product.image.bind',
  PRODUCT_IMAGE_DELETE: 'product.image.delete',
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
  PLATFORM_SETTING: 'PlatformSetting',
  /** Admin Delivery Zones + Pricing APIs v1.0. */
  DELIVERY_ZONE: 'DeliveryZone',
  DELIVERY_PRICING_RULE: 'DeliveryPricingRule',
  COMMERCE_VERTICAL: 'CommerceVertical',
  MERCHANT_BRANCH: 'MerchantBranch',
  PRODUCT: 'Product',
} as const);

export type AdminAuditTargetType =
  (typeof ADMIN_AUDIT_TARGET_TYPES)[keyof typeof ADMIN_AUDIT_TARGET_TYPES];
