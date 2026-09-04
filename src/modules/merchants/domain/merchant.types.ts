import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  MERCHANT_OPTIONAL_DOCUMENT_TYPES,
  MERCHANT_REQUIRED_DOCUMENT_TYPES,
  canEditVerificationEvidence,
  deriveMerchantReadiness,
  isEvidenceDocumentComplete,
  isOptionalExpiryValid,
  isRequiredDocumentExpiredAttention,
  isVerificationFormallySubmitted,
  isVerificationReady,
} from './merchant.policy';

export {
  MERCHANT_BRANCH_OPERATIONAL_STATUS_ACTIVE,
  MERCHANT_BRANCH_OPERATIONAL_STATUS_INACTIVE,
  MERCHANT_BRANCH_OPERATIONAL_STATUS_SUSPENDED,
  MERCHANT_BRANCH_OPERATIONAL_STATUSES,
  MERCHANT_CAPABILITIES,
  MERCHANT_DOCUMENT_BUSINESS_IDENTITY,
  MERCHANT_DOCUMENT_BUSINESS_REGISTRATION,
  MERCHANT_DOCUMENT_STATUS_PENDING,
  MERCHANT_DOCUMENT_STATUS_SUBMITTED,
  MERCHANT_DOCUMENT_SUPPORTING,
  MERCHANT_DOCUMENT_TYPES,
  MERCHANT_MEMBER_ROLE_MANAGER,
  MERCHANT_MEMBER_ROLE_OWNER,
  MERCHANT_MEMBER_ROLE_STAFF,
  MERCHANT_MEMBER_ROLES,
  MERCHANT_OPTIONAL_DOCUMENT_TYPES,
  MERCHANT_REQUIRED_DOCUMENT_TYPES,
  MERCHANT_STATUS_ACTIVE,
  MERCHANT_STATUS_PENDING_REVIEW,
  MERCHANT_STATUS_REJECTED,
  MERCHANT_STATUS_SUSPENDED,
  MERCHANT_STATUSES,
  canEditVerificationEvidence,
  canSubmitMerchantVerification,
  deriveMerchantReadiness,
  isBusinessIdentityComplete,
  isBusinessRegistrationComplete,
  isEvidenceDocumentComplete,
  isMerchantApproved,
  isMerchantProfileComplete,
  isOptionalExpiryValid,
  isRequiredDocumentExpiredAttention,
  isVerificationFormallySubmitted,
  isVerificationReady,
  objectKeyForMerchantDocument,
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

export type MerchantEvidenceChecklistItem = {
  type: string;
  required: boolean;
  present: boolean;
  complete: boolean;
  status: string | null;
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
  verificationReady: boolean;
  verificationSubmitted: boolean;
  verificationAttentionRequired: boolean;
  merchant: MerchantView;
  branches: MerchantBranchView[];
  documents: MerchantDocumentView[];
  evidenceChecklist: MerchantEvidenceChecklistItem[];
};

export type MerchantMeView = {
  merchantMembershipExists: boolean;
  memberships: MerchantMembershipView[];
};

export type MerchantVerificationPackageView = {
  merchantId: string;
  status: string;
  verifiedAt: string | null;
  verificationReady: boolean;
  verificationSubmitted: boolean;
  verificationAttentionRequired: boolean;
  evidenceEditable: boolean;
  evidenceChecklist: MerchantEvidenceChecklistItem[];
  documents: MerchantDocumentView[];
};

export type UpsertMerchantDocumentInput = {
  type: string;
  expiryDate?: string | null;
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

export function buildEvidenceChecklist(
  documents: MerchantDocumentSummary[],
): MerchantEvidenceChecklistItem[] {
  const types = [
    ...MERCHANT_REQUIRED_DOCUMENT_TYPES.map((type) => ({
      type,
      required: true as const,
    })),
    ...MERCHANT_OPTIONAL_DOCUMENT_TYPES.map((type) => ({
      type,
      required: false as const,
    })),
  ];
  return types.map(({ type, required }) => {
    const matches = documents.filter((row) => row.type === type);
    if (matches.length > 1) {
      return {
        type,
        required,
        present: true,
        complete: false,
        status: null,
        expiryDate: null,
      };
    }
    const document = matches[0] ?? null;
    let complete = false;
    if (document) {
      if (required) {
        complete = isEvidenceDocumentComplete(
          {
            type: document.type,
            status: document.status,
            expiryDate: document.expiryDate,
          },
          type,
        );
      } else {
        complete = isOptionalExpiryValid(document.expiryDate);
      }
    }
    return {
      type,
      required,
      present: document !== null,
      complete,
      status: document?.status ?? null,
      expiryDate: document?.expiryDate ?? null,
    };
  });
}

export function toMembershipView(input: {
  member: MerchantMemberRecord;
  merchant: MerchantRecord;
  branches: MerchantBranchRecord[];
  documents: MerchantDocumentSummary[];
  includeDocuments?: boolean;
  includeChecklist?: boolean;
}): MerchantMembershipView {
  const readiness = deriveMerchantReadiness({
    name: input.merchant.name,
    status: input.merchant.status,
    verifiedAt: input.merchant.verifiedAt,
    branchOperationalStatuses: input.branches.map(
      (branch) => branch.operationalStatus,
    ),
  });
  const evidence = input.documents.map((document) => ({
    type: document.type,
    status: document.status,
    expiryDate: document.expiryDate,
  }));
  const includeDocuments = input.includeDocuments !== false;
  const includeChecklist = input.includeChecklist !== false;
  return {
    merchantId: input.merchant.id,
    role: input.member.role,
    createdAt: input.member.createdAt,
    ...readiness,
    verificationReady: isVerificationReady({
      name: input.merchant.name,
      documents: evidence,
    }),
    verificationSubmitted: isVerificationFormallySubmitted(evidence),
    verificationAttentionRequired: isRequiredDocumentExpiredAttention({
      status: input.merchant.status,
      verifiedAt: input.merchant.verifiedAt,
      documents: evidence,
    }),
    merchant: toMerchantView(input.merchant),
    branches: input.branches.map(toBranchView),
    documents: includeDocuments ? input.documents.map(toDocumentView) : [],
    evidenceChecklist: includeChecklist
      ? buildEvidenceChecklist(input.documents)
      : [],
  };
}

export function toVerificationPackageView(input: {
  merchant: MerchantRecord;
  documents: MerchantDocumentSummary[];
}): MerchantVerificationPackageView {
  const evidence = input.documents.map((document) => ({
    type: document.type,
    status: document.status,
    expiryDate: document.expiryDate,
  }));
  return {
    merchantId: input.merchant.id,
    status: input.merchant.status,
    verifiedAt: input.merchant.verifiedAt,
    verificationReady: isVerificationReady({
      name: input.merchant.name,
      documents: evidence,
    }),
    verificationSubmitted: isVerificationFormallySubmitted(evidence),
    verificationAttentionRequired: isRequiredDocumentExpiredAttention({
      status: input.merchant.status,
      verifiedAt: input.merchant.verifiedAt,
      documents: evidence,
    }),
    evidenceEditable: canEditVerificationEvidence({
      status: input.merchant.status,
      documents: evidence,
    }),
    evidenceChecklist: buildEvidenceChecklist(input.documents),
    documents: input.documents.map(toDocumentView),
  };
}

export function newPublicReference(): string {
  return `sgm_${createUuidV7().replaceAll('-', '')}`;
}
