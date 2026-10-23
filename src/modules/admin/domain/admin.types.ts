export type CurrentAdminContext = {
  adminProfileId: string;
  accountId: string;
  sessionId: string;
  displayName: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  /** Admin UI + IN_APP notification emit locale (`fr` | `ar`). */
  preferredLocale: 'fr' | 'ar';
};

export const ADMIN_LIST_DEFAULT_LIMIT = 50;
export const ADMIN_LIST_MAX_LIMIT = 100;
export const ADMIN_LIST_MAX_OFFSET = 10_000;

export type AdminListQuery = {
  limit: number;
  offset: number;
};

export type AdminMerchantListItem = {
  id: string;
  name: string;
  status: string;
  verifiedAt: string | null;
  publicReference: string;
  createdAt: string;
};

export type AdminMerchantQueueItem = AdminMerchantListItem & {
  verificationReady: boolean;
  verificationSubmitted: boolean;
  /** Count of MerchantDocument rows — never includes fileUrl/object keys. */
  documentsReceived: number;
};

export type AdminVerificationDocumentItem = {
  id: string;
  type: string;
  status: string;
  expiryDate: string | null;
};

export type AdminDriverListItem = {
  id: string;
  fullName: string;
  verificationStatus: string;
  approvedAt: string | null;
  createdAt: string;
  /**
   * Present on verification queue enrichment only.
   * Never includes fileUrl/object keys.
   */
  documentsReceived?: number;
  vehicleType?: string | null;
  vehiclePlate?: string | null;
};

/**
 * Open (unreleased) assignment for Admin driver detail.
 * Null when the driver has no current mission — distinct from “read unavailable”.
 */
export type AdminDriverCurrentMission = {
  assignmentId: string;
  assignmentStatus: string;
  deliveryId: string;
  deliveryStatus: string;
  orderId: string;
  orderPublicReference: string;
};

/**
 * Matching occupancy derived from availability + open assignment.
 * ONLINE alone does not mean free: ONLINE + open assignment → ONLINE_ON_MISSION.
 */
export type AdminDriverMatchingOccupancy =
  | 'OFFLINE'
  | 'ONLINE_AVAILABLE'
  | 'ONLINE_ON_MISSION'
  | 'UNKNOWN';

/** GET /admin/drivers/:id — list fields plus operational availability / mission. */
export type AdminDriverDetail = AdminDriverListItem & {
  /** `driver_availability.status`, or null when no availability row exists. */
  availabilityStatus: string | null;
  matchingOccupancy: AdminDriverMatchingOccupancy;
  currentMission: AdminDriverCurrentMission | null;
};

/** Admin drivers.verify read package — metadata only, no storage keys. */
export type AdminDriverVerificationPackage = {
  driverId: string;
  fullName: string;
  verificationStatus: string;
  approvedAt: string | null;
  createdAt: string;
  documents: AdminVerificationDocumentItem[];
  vehicle: {
    type: string;
    plateNumber: string;
    model: string;
  } | null;
};

export type AdminCustomerColocated = {
  hasAdminProfile: boolean;
  hasDriverProfile: boolean;
  hasMerchantMembership: boolean;
};

export type AdminCustomerListItem = {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  /** Account phone when present — Admin customers.read only; never OTP/session secrets. */
  phone: string | null;
  /** Account.status — not a CustomerProfile field. */
  accountStatus: string;
  createdAt: string;
};

/** Detail expands Account lifecycle fields — still no CustomerProfile.status. */
export type AdminCustomerDetail = AdminCustomerListItem & {
  accountId: string;
  colocated: AdminCustomerColocated;
};

export type AdminCustomerComplaintItem = {
  id: string;
  publicReference: string;
  subject: string | null;
  topicCode: string | null;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminCustomerLifecycleResult = {
  customerId: string;
  accountId: string;
  accountStatus: string;
  alreadyApplied: boolean;
  sessionsRevoked: number;
  colocated: AdminCustomerColocated;
};

export type AdminCustomerInternalNoteItem = {
  id: string;
  customerId: string;
  adminId: string;
  authorDisplayName: string;
  category: string;
  body: string;
  createdAt: string;
};

export type AdminCustomerAddressItem = {
  id: string;
  customerId: string;
  label: string;
  addressText: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminOrderListItem = {
  id: string;
  publicReference: string;
  customerId: string;
  merchantBranchId: string;
  status: string;
  fulfillmentStatus: string;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  /** Batched from CustomerProfile — null if profile missing. */
  customerFullName: string | null;
  /** Batched from CustomerProfile.avatarUrl — null when absent. */
  customerAvatarUrl: string | null;
  /** Batched from Merchant via branch — null if unresolved. */
  merchantName: string | null;
  merchantBranchName: string | null;
  /**
   * Authoritative customer payable from OrderFinancialSnapshot.
   * Null when snapshot row absent — never fabricated zeros.
   */
  customerPayableMinor: string | null;
  currency: string | null;
};

export type AdminOrderItemOption = {
  optionNameSnapshot: string;
  additionalPriceMinor: string;
};

export type AdminOrderItem = {
  id: string;
  productId: string | null;
  productNameSnapshot: string;
  quantity: number;
  unitPriceMinor: string;
  lineTotalMinor: string;
  options: AdminOrderItemOption[];
};

/** Immutable OrderFinancialSnapshot fields as decimal minor strings. Null when no row. */
export type AdminOrderFinancialSnapshot = {
  currency: string;
  grossMerchandiseSubtotalMinor: string;
  merchantDiscountMinor: string;
  platformDiscountMinor: string;
  totalDiscountMinor: string;
  commissionBaseMinor: string;
  merchantCommissionRateBps: number;
  merchantCommissionAmountMinor: string;
  merchantNetAmountMinor: string;
  customerDeliveryFeeMinor: string;
  driverRemunerationMinor: string;
  speedyGoDeliveryShareMinor: string;
  serviceFeeMinor: string;
  customerPayableMinor: string;
  commissionRuleId: string;
  pricingRuleId: string;
  createdAt: string;
};

export type AdminOrderDeliveryAddress = {
  addressText: string;
  latitude: number;
  longitude: number;
  instructions: string | null;
};

export type AdminOrderPaymentSummary = {
  id: string;
  method: string;
  status: string;
  amountMinor: string;
  currency: string;
};

export type AdminOrderCustomerParty = {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  phone: string | null;
};

export type AdminOrderMerchantParty = {
  merchantId: string;
  merchantName: string;
  publicReference: string;
  branchId: string;
  branchName: string;
  phone: string;
  addressText: string;
  wilayaCode: string | null;
};

export type AdminOrderDriverParty = {
  driverId: string;
  fullName: string;
  assignmentStatus: string;
  deliveryStatus: string;
};

/**
 * Authoritative timeline entry — only persisted OrderStatusEvent / DeliveryEvent clocks.
 * Never reconstructed from current status alone.
 */
export type AdminOrderTimelineEvent = {
  source: 'ORDER_STATUS' | 'DELIVERY';
  eventType: string;
  actorType: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  occurredAt: string;
  driverId: string | null;
  /** Resolved DriverProfile.fullName when driverId present; else null. */
  driverFullName: string | null;
};

/** Additive enrichment of GET /admin/orders/:id — list fields unchanged. */
export type AdminOrderDetail = AdminOrderListItem & {
  items: AdminOrderItem[];
  /** Null when OrderFinancialSnapshot row is absent — never fabricated zeros. */
  financial: AdminOrderFinancialSnapshot | null;
  deliveryAddress: AdminOrderDeliveryAddress | null;
  payment: AdminOrderPaymentSummary | null;
  customer: AdminOrderCustomerParty | null;
  merchant: AdminOrderMerchantParty | null;
  driver: AdminOrderDriverParty | null;
  /** Present when a Delivery row exists — used for Admin assign eligibility. */
  delivery: { id: string; status: string } | null;
  /** Merged OrderStatusEvent + DeliveryEvent sorted by occurredAt ascending. */
  timeline: AdminOrderTimelineEvent[];
};

export type AdminMerchantBranchStoreItem = {
  id: string;
  merchantId: string;
  name: string;
  phone: string;
  addressText: string;
  wilayaCode: string | null;
  communeId: number | null;
  /** Branch operationalStatus — distinct from Merchant.status. */
  operationalStatus: string;
  description: string | null;
  nameAr: string | null;
  publicEmail: string | null;
  availability: {
    hoursConfigured: boolean;
    acceptingOrders: boolean;
    availabilityMode: string;
    effectiveMode: string;
    closedUntil: string | null;
    reasonCode: string | null;
    customerMessage: string | null;
    timezone: string;
    currentClosesAt: string | null;
    nextOpenAt: string | null;
  };
};

export type AdminPaymentListItem = {
  id: string;
  orderId: string;
  method: string;
  status: string;
  amountMinor: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminRefundListItem = {
  id: string;
  orderId: string;
  paymentTransactionId: string | null;
  refundMethod: string;
  amountMinor: string;
  status: string;
  reason: string;
  internalNote: string | null;
  requestedByAdminId: string | null;
  requestedAt: string;
  completedAt: string | null;
  createdAt: string;
};

export type AdminSettlementListItem = {
  id: string;
  merchantId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  grossSalesMinor: string;
  commissionMinor: string;
  refundAdjustmentsMinor: string;
  manualAdjustmentsMinor: string;
  netPayableMinor: string;
  paidAt: string | null;
  createdAt: string;
};

export type AdminPromotionListItem = {
  id: string;
  code: string;
  type: string;
  /** Rate BPS for percentage promos; FIXED v1: centimes digit-string. */
  value: number | string;
  /** FIXED dzd-v2 twin ("250.00"). Null for RATE_BPS. */
  valueAmount: string | null;
  startsAt: string;
  endsAt: string;
  active: boolean;
  customerDiscoverable: boolean;
  customerLabel: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminCodRemittanceListItem = {
  id: string;
  driverId: string;
  submittedAmountMinor: string;
  confirmedAmountMinor: string;
  status: string;
  reference: string;
  submittedAt: string;
  confirmedAt: string | null;
  createdAt: string;
};

export type AdminAuditListItem = {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  beforeJson: unknown;
  afterJson: unknown;
  ipAddress: string | null;
  sessionId: string | null;
  createdAt: string;
};

export type AdminAuditListQuery = AdminListQuery & {
  adminId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  createdFrom?: string;
  createdTo?: string;
};

export type AdminPaginatedResult<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};
