import { createUuidV7 } from '../../../common/utils/uuid-v7';
import { deriveMerchantReadiness } from './merchant.policy';

export {
  MERCHANT_BRANCH_OPERATIONAL_STATUS_ACTIVE,
  MERCHANT_BRANCH_OPERATIONAL_STATUS_INACTIVE,
  MERCHANT_BRANCH_OPERATIONAL_STATUS_SUSPENDED,
  MERCHANT_BRANCH_OPERATIONAL_STATUSES,
  MERCHANT_CAPABILITIES,
  MERCHANT_MEMBER_ROLE_MANAGER,
  MERCHANT_MEMBER_ROLE_OWNER,
  MERCHANT_MEMBER_ROLE_STAFF,
  MERCHANT_MEMBER_ROLES,
  MERCHANT_STATUS_ACTIVE,
  MERCHANT_STATUS_PENDING_REVIEW,
  MERCHANT_STATUS_REJECTED,
  MERCHANT_STATUS_SUSPENDED,
  MERCHANT_STATUSES,
  deriveMerchantReadiness,
  isMerchantApproved,
  isMerchantProfileComplete,
  parseBranchOperationalStatus,
  parseMerchantMemberRole,
  parseMerchantStatus,
} from './merchant.policy';

export const MERCHANT_BRANCH_ADDRESS_TEXT_MAX_LENGTH = 500;

export type MerchantRecord = {
  id: string;
  publicReference: string;
  name: string;
  status: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MerchantMemberRecord = {
  id: string;
  merchantId: string;
  accountId: string;
  role: string;
  createdAt: string;
};

export type MerchantBranchRecord = {
  id: string;
  merchantId: string;
  name: string;
  phone: string;
  addressText: string;
  latitude: number;
  longitude: number;
  operationalStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type MerchantDocumentSummary = {
  id: string;
  merchantId: string;
  type: string;
  status: string;
  expiryDate: string | null;
};

export type CreateMerchantInput = {
  name: string;
};

export type UpdateMerchantInput = {
  name?: string;
};

export type CreateBranchInput = {
  name: string;
  phone: string;
  addressText: string;
  latitude: number;
  longitude: number;
};

export type UpdateBranchInput = {
  name?: string;
  phone?: string;
  addressText?: string;
  latitude?: number;
  longitude?: number;
};

export type MerchantView = {
  id: string;
  publicReference: string;
  name: string;
  status: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MerchantBranchView = {
  id: string;
  name: string;
  phone: string;
  addressText: string;
  latitude: number;
  longitude: number;
  operationalStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type MerchantDocumentView = {
  id: string;
  type: string;
  status: string;
  expiryDate: string | null;
};

export type MerchantMembershipView = {
  merchantId: string;
  role: string;
  createdAt: string;
  profileComplete: boolean;
  hasBranch: boolean;
  branchReady: boolean;
  approved: boolean;
  operationalReady: boolean;
  merchant: MerchantView;
  branches: MerchantBranchView[];
  documents: MerchantDocumentView[];
};

export type MerchantMeView = {
  merchantMembershipExists: boolean;
  memberships: MerchantMembershipView[];
};

export function hasValidCoordinates(
  latitude: number,
  longitude: number,
): boolean {
  return (
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function toMerchantView(merchant: MerchantRecord): MerchantView {
  return {
    id: merchant.id,
    publicReference: merchant.publicReference,
    name: merchant.name,
    status: merchant.status,
    verifiedAt: merchant.verifiedAt,
    createdAt: merchant.createdAt,
    updatedAt: merchant.updatedAt,
  };
}

export function toBranchView(branch: MerchantBranchRecord): MerchantBranchView {
  return {
    id: branch.id,
    name: branch.name,
    phone: branch.phone,
    addressText: branch.addressText,
    latitude: branch.latitude,
    longitude: branch.longitude,
    operationalStatus: branch.operationalStatus,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}

export function toDocumentView(
  document: MerchantDocumentSummary,
): MerchantDocumentView {
  return {
    id: document.id,
    type: document.type,
    status: document.status,
    expiryDate: document.expiryDate,
  };
}

export function toMembershipView(input: {
  member: MerchantMemberRecord;
  merchant: MerchantRecord;
  branches: MerchantBranchRecord[];
  documents: MerchantDocumentSummary[];
}): MerchantMembershipView {
  const readiness = deriveMerchantReadiness({
    name: input.merchant.name,
    status: input.merchant.status,
    verifiedAt: input.merchant.verifiedAt,
    branchOperationalStatuses: input.branches.map(
      (branch) => branch.operationalStatus,
    ),
  });
  return {
    merchantId: input.merchant.id,
    role: input.member.role,
    createdAt: input.member.createdAt,
    ...readiness,
    merchant: toMerchantView(input.merchant),
    branches: input.branches.map(toBranchView),
    documents: input.documents.map(toDocumentView),
  };
}

export function newPublicReference(): string {
  return `sgm_${createUuidV7().replaceAll('-', '')}`;
}
