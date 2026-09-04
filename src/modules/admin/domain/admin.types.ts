export type CurrentAdminContext = {
  adminProfileId: string;
  accountId: string;
  sessionId: string;
  displayName: string;
  roleId: string;
  roleName: string;
  permissions: string[];
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
};

export type AdminDriverListItem = {
  id: string;
  fullName: string;
  verificationStatus: string;
  approvedAt: string | null;
  createdAt: string;
};

export type AdminCustomerListItem = {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  createdAt: string;
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
};

export type AdminPaymentListItem = {
  id: string;
  orderId: string;
  method: string;
  status: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminRefundListItem = {
  id: string;
  orderId: string;
  paymentTransactionId: string | null;
  refundMethod: string;
  amountMinor: number;
  status: string;
  reason: string;
  internalNote: string | null;
  requestedByAdminId: string;
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
  grossSalesMinor: number;
  commissionMinor: number;
  refundAdjustmentsMinor: number;
  manualAdjustmentsMinor: number;
  netPayableMinor: number;
  paidAt: string | null;
  createdAt: string;
};

export type AdminPromotionListItem = {
  id: string;
  code: string;
  type: string;
  value: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminCodRemittanceListItem = {
  id: string;
  driverId: string;
  submittedAmountMinor: number;
  confirmedAmountMinor: number;
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
