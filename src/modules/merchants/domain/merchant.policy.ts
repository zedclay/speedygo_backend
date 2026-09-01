export const MERCHANT_MEMBER_ROLES = ['OWNER', 'MANAGER', 'STAFF'] as const;
export type MerchantMemberRole = (typeof MERCHANT_MEMBER_ROLES)[number];

export const MERCHANT_MEMBER_ROLE_OWNER = 'OWNER' satisfies MerchantMemberRole;
export const MERCHANT_MEMBER_ROLE_MANAGER =
  'MANAGER' satisfies MerchantMemberRole;
export const MERCHANT_MEMBER_ROLE_STAFF = 'STAFF' satisfies MerchantMemberRole;

export const MERCHANT_STATUSES = [
  'PENDING_REVIEW',
  'ACTIVE',
  'REJECTED',
  'SUSPENDED',
] as const;
export type MerchantStatus = (typeof MERCHANT_STATUSES)[number];

export const MERCHANT_STATUS_PENDING_REVIEW =
  'PENDING_REVIEW' satisfies MerchantStatus;
export const MERCHANT_STATUS_ACTIVE = 'ACTIVE' satisfies MerchantStatus;
export const MERCHANT_STATUS_REJECTED = 'REJECTED' satisfies MerchantStatus;
export const MERCHANT_STATUS_SUSPENDED = 'SUSPENDED' satisfies MerchantStatus;

export const MERCHANT_BRANCH_OPERATIONAL_STATUSES = [
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
] as const;
export type MerchantBranchOperationalStatus =
  (typeof MERCHANT_BRANCH_OPERATIONAL_STATUSES)[number];

export const MERCHANT_BRANCH_OPERATIONAL_STATUS_ACTIVE =
  'ACTIVE' satisfies MerchantBranchOperationalStatus;
export const MERCHANT_BRANCH_OPERATIONAL_STATUS_INACTIVE =
  'INACTIVE' satisfies MerchantBranchOperationalStatus;
export const MERCHANT_BRANCH_OPERATIONAL_STATUS_SUSPENDED =
  'SUSPENDED' satisfies MerchantBranchOperationalStatus;

export const MERCHANT_CAPABILITIES = {
  MERCHANT_PROFILE_UPDATE: 'MERCHANT_PROFILE_UPDATE',
  MERCHANT_BRANCH_CREATE: 'MERCHANT_BRANCH_CREATE',
  MERCHANT_BRANCH_UPDATE: 'MERCHANT_BRANCH_UPDATE',
  MERCHANT_BRANCH_DELETE: 'MERCHANT_BRANCH_DELETE',
  MERCHANT_READ: 'MERCHANT_READ',
  CATALOG_READ: 'CATALOG_READ',
  CATEGORY_MANAGE: 'CATEGORY_MANAGE',
  PRODUCT_MANAGE: 'PRODUCT_MANAGE',
  PRODUCT_OPTIONS_MANAGE: 'PRODUCT_OPTIONS_MANAGE',
  ORDER_READ: 'ORDER_READ',
  ORDER_WORKFLOW_MUTATE: 'ORDER_WORKFLOW_MUTATE',
} as const;

export type MerchantCapability =
  (typeof MERCHANT_CAPABILITIES)[keyof typeof MERCHANT_CAPABILITIES];

export function parseMerchantMemberRole(
  raw: string,
): MerchantMemberRole | null {
  return MERCHANT_MEMBER_ROLES.includes(raw as MerchantMemberRole)
    ? (raw as MerchantMemberRole)
    : null;
}

export function parseMerchantStatus(raw: string): MerchantStatus | null {
  return MERCHANT_STATUSES.includes(raw as MerchantStatus)
    ? (raw as MerchantStatus)
    : null;
}

export function parseBranchOperationalStatus(
  raw: string,
): MerchantBranchOperationalStatus | null {
  return MERCHANT_BRANCH_OPERATIONAL_STATUSES.includes(
    raw as MerchantBranchOperationalStatus,
  )
    ? (raw as MerchantBranchOperationalStatus)
    : null;
}

export function roleHasCapability(
  role: MerchantMemberRole,
  capability: MerchantCapability,
): boolean {
  switch (capability) {
    case MERCHANT_CAPABILITIES.MERCHANT_READ:
    case MERCHANT_CAPABILITIES.CATALOG_READ:
    case MERCHANT_CAPABILITIES.ORDER_READ:
      return true;
    case MERCHANT_CAPABILITIES.MERCHANT_PROFILE_UPDATE:
      return role === MERCHANT_MEMBER_ROLE_OWNER;
    case MERCHANT_CAPABILITIES.MERCHANT_BRANCH_CREATE:
    case MERCHANT_CAPABILITIES.MERCHANT_BRANCH_UPDATE:
    case MERCHANT_CAPABILITIES.MERCHANT_BRANCH_DELETE:
    case MERCHANT_CAPABILITIES.CATEGORY_MANAGE:
    case MERCHANT_CAPABILITIES.PRODUCT_MANAGE:
    case MERCHANT_CAPABILITIES.PRODUCT_OPTIONS_MANAGE:
    case MERCHANT_CAPABILITIES.ORDER_WORKFLOW_MUTATE:
      return (
        role === MERCHANT_MEMBER_ROLE_OWNER ||
        role === MERCHANT_MEMBER_ROLE_MANAGER
      );
    default:
      return false;
  }
}

export function statusAllowsProfileUpdate(status: MerchantStatus): boolean {
  return (
    status === MERCHANT_STATUS_PENDING_REVIEW ||
    status === MERCHANT_STATUS_REJECTED
  );
}

export function statusAllowsBranchMutation(status: MerchantStatus): boolean {
  return (
    status === MERCHANT_STATUS_PENDING_REVIEW ||
    status === MERCHANT_STATUS_REJECTED ||
    status === MERCHANT_STATUS_ACTIVE
  );
}

export function statusAllowsCatalogMutation(status: MerchantStatus): boolean {
  return statusAllowsBranchMutation(status);
}

export function isMerchantProfileComplete(name: string): boolean {
  return name.trim().length > 0;
}

export function isMerchantApproved(
  status: string,
  verifiedAt: string | null,
): boolean {
  return status === MERCHANT_STATUS_ACTIVE && verifiedAt !== null;
}

export function isBranchOperationallyActive(
  operationalStatus: string,
): boolean {
  return operationalStatus === MERCHANT_BRANCH_OPERATIONAL_STATUS_ACTIVE;
}

export function deriveMerchantReadiness(input: {
  name: string;
  status: string;
  verifiedAt: string | null;
  branchOperationalStatuses: string[];
}): {
  profileComplete: boolean;
  hasBranch: boolean;
  branchReady: boolean;
  approved: boolean;
  operationalReady: boolean;
} {
  const profileComplete = isMerchantProfileComplete(input.name);
  const hasBranch = input.branchOperationalStatuses.length > 0;
  const branchReady = input.branchOperationalStatuses.some(
    isBranchOperationallyActive,
  );
  const approved = isMerchantApproved(input.status, input.verifiedAt);
  return {
    profileComplete,
    hasBranch,
    branchReady,
    approved,
    operationalReady: profileComplete && approved && branchReady,
  };
}
