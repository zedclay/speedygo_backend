import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  LEGAL_KIND_DOSSIER_ACCURACY_DECLARATION,
  LEGAL_KIND_MERCHANT_TERMS,
  MERCHANT_MEMBER_ROLE_OWNER,
  MERCHANT_MEMBER_ROLE_MANAGER,
  MERCHANT_OPTIONAL_DOCUMENT_TYPES,
  MERCHANT_REQUIRED_DOCUMENT_TYPES,
  VERIFICATION_OUTCOME_REJECTED,
  canEditVerificationEvidence,
  deriveMerchantReadiness,
  isEvidenceDocumentComplete,
  isOptionalExpiryValid,
  isRequiredDocumentExpiredAttention,
  isVerificationFormallySubmitted,
  isVerificationReady,
  parseMerchantMemberRole,
} from './merchant.policy';

export {
  LEGAL_KIND_DOSSIER_ACCURACY_DECLARATION,
  LEGAL_KIND_MERCHANT_TERMS,
  LEGAL_KINDS,
  LEGAL_SEED_VERSION,
  VERIFICATION_APPLICATION_ISSUE_CODES,
  VERIFICATION_DOCUMENT_ISSUE_CODES,
  VERIFICATION_ISSUE_SCOPE_APPLICATION,
  VERIFICATION_ISSUE_SCOPE_DOCUMENT,
  VERIFICATION_ISSUE_SCOPES,
  VERIFICATION_OUTCOME_APPROVED,
  VERIFICATION_OUTCOME_PENDING_REVIEW,
  VERIFICATION_OUTCOME_REJECTED,
  evaluateLegalAcceptances,
  isLegalKind,
  validateRejectionIssues,
  type LegalAcceptanceInput,
  type LegalKind,
  type RejectionIssueInput,
  type ValidatedRejectionIssue,
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
  wilayaCode: string | null;
  communeId: number | null;
  operationalStatus: string;
  description: string | null;
  nameAr: string | null;
  publicEmail: string | null;
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
  wilayaCode: string;
  communeId: number;
};

export type UpdateBranchInput = {
  name?: string;
  phone?: string;
  addressText?: string;
  latitude?: number;
  longitude?: number;
  wilayaCode?: string;
  communeId?: number;
  description?: string | null;
  nameAr?: string | null;
  publicEmail?: string | null;
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

export type MerchantBranchClassificationView = {
  verticalId: string;
  slug: string;
  name: string;
  iconKey: string;
};

export type MerchantBranchView = {
  id: string;
  name: string;
  phone: string;
  addressText: string;
  latitude: number;
  longitude: number;
  wilayaCode: string | null;
  communeId: number | null;
  wilayaNameFr: string | null;
  communeNameFr: string | null;
  operationalStatus: string;
  description: string | null;
  nameAr: string | null;
  publicEmail: string | null;
  classification: MerchantBranchClassificationView | null;
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

export type LegalDocumentVersionRecord = {
  id: string;
  kind: string;
  version: string;
  contentUrl: string | null;
  contentSha256: string | null;
  effectiveFrom: string;
  active: boolean;
};

export type LegalDocumentVersionView = {
  kind: string;
  version: string;
  contentUrl: string | null;
  contentSha256: string | null;
  effectiveFrom: string;
};

export type MerchantCurrentLegalView = {
  versions: LegalDocumentVersionView[];
};

export type VerificationSubmissionRecord = {
  id: string;
  merchantId: string;
  attemptNumber: number;
  submittedAt: string;
  submittedByAccountId: string;
  outcome: string;
  reviewedAt: string | null;
  reviewedByAdminId: string | null;
};

export type LegalAcceptanceRecord = {
  id: string;
  merchantId: string;
  submissionId: string;
  kind: string;
  version: string;
  acceptedAt: string;
};

export type VerificationIssueRecord = {
  id: string;
  submissionId: string;
  merchantId: string;
  scope: string;
  documentType: string | null;
  documentId: string | null;
  code: string;
  messageFr: string;
  resolvedAt: string | null;
  createdAt: string;
};

export type MerchantVerificationRecords = {
  submissions: VerificationSubmissionRecord[];
  acceptances: LegalAcceptanceRecord[];
  unresolvedIssues: VerificationIssueRecord[];
};

export type MerchantVerificationIssueView = {
  id: string;
  scope: string;
  code: string;
  messageFr: string;
  documentType: string | null;
  createdAt: string;
};

export type MerchantLegalAcceptanceView = {
  termsVersion: string;
  declarationVersion: string;
  acceptedAt: string;
};

/**
 * Submission / consent / issue read model. Legacy Merchants (no submission
 * rows) resolve to null / [] / 0.
 */
export type MerchantVerificationReviewView = {
  submittedAt: string | null;
  reviewedAt: string | null;
  attemptNumber: number | null;
  legalAcceptance: MerchantLegalAcceptanceView | null;
  currentIssues: MerchantVerificationIssueView[];
  unresolvedIssueCount: number;
};

export function emptyVerificationReviewView(): MerchantVerificationReviewView {
  return {
    submittedAt: null,
    reviewedAt: null,
    attemptNumber: null,
    legalAcceptance: null,
    currentIssues: [],
    unresolvedIssueCount: 0,
  };
}

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
} & MerchantVerificationReviewView;

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
} & MerchantVerificationReviewView;

export type UpsertMerchantDocumentInput = {
  type: string;
  expiryDate?: string | null;
  uploadReference?: string;
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

export function toBranchView(
  branch: MerchantBranchRecord,
  names?: { wilayaNameFr: string | null; communeNameFr: string | null },
  classification: MerchantBranchClassificationView | null = null,
): MerchantBranchView {
  return {
    id: branch.id,
    name: branch.name,
    phone: branch.phone,
    addressText: branch.addressText,
    latitude: branch.latitude,
    longitude: branch.longitude,
    wilayaCode: branch.wilayaCode,
    communeId: branch.communeId,
    wilayaNameFr: names?.wilayaNameFr ?? null,
    communeNameFr: names?.communeNameFr ?? null,
    operationalStatus: branch.operationalStatus,
    description: branch.description ?? null,
    nameAr: branch.nameAr ?? null,
    publicEmail: branch.publicEmail ?? null,
    classification,
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

export function toLegalVersionView(
  record: LegalDocumentVersionRecord,
): LegalDocumentVersionView {
  return {
    kind: record.kind,
    version: record.version,
    contentUrl: record.contentUrl,
    contentSha256: record.contentSha256,
    effectiveFrom: record.effectiveFrom,
  };
}

/**
 * Picks the single current row per kind (latest effectiveFrom among active).
 */
export function pickCurrentLegalVersions(
  rows: LegalDocumentVersionRecord[],
): LegalDocumentVersionRecord[] {
  const byKind = new Map<string, LegalDocumentVersionRecord>();
  for (const row of rows) {
    if (!row.active) {
      continue;
    }
    const existing = byKind.get(row.kind);
    if (!existing || row.effectiveFrom > existing.effectiveFrom) {
      byKind.set(row.kind, row);
    }
  }
  return [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}

function toIssueView(
  issue: VerificationIssueRecord,
): MerchantVerificationIssueView {
  return {
    id: issue.id,
    scope: issue.scope,
    code: issue.code,
    messageFr: issue.messageFr,
    documentType: issue.documentType,
    createdAt: issue.createdAt,
  };
}

/**
 * Builds the submission / consent / issue read model for ONE Merchant.
 * `currentIssues` = unresolved issues on the latest REJECTED submission.
 */
export function buildVerificationReviewView(
  records: MerchantVerificationRecords,
): MerchantVerificationReviewView {
  const latest = [...records.submissions].sort(
    (a, b) => b.attemptNumber - a.attemptNumber,
  )[0];
  if (!latest) {
    return emptyVerificationReviewView();
  }
  const latestRejected = [...records.submissions]
    .filter((row) => row.outcome === VERIFICATION_OUTCOME_REJECTED)
    .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
  const currentIssues = latestRejected
    ? records.unresolvedIssues
        .filter(
          (issue) =>
            issue.submissionId === latestRejected.id &&
            issue.resolvedAt === null,
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(toIssueView)
    : [];
  const forLatest = records.acceptances.filter(
    (row) => row.submissionId === latest.id,
  );
  const terms = forLatest.find((row) => row.kind === LEGAL_KIND_MERCHANT_TERMS);
  const declaration = forLatest.find(
    (row) => row.kind === LEGAL_KIND_DOSSIER_ACCURACY_DECLARATION,
  );
  return {
    submittedAt: latest.submittedAt,
    reviewedAt: latest.reviewedAt,
    attemptNumber: latest.attemptNumber,
    legalAcceptance:
      terms && declaration
        ? {
            termsVersion: terms.version,
            declarationVersion: declaration.version,
            acceptedAt:
              terms.acceptedAt >= declaration.acceptedAt
                ? terms.acceptedAt
                : declaration.acceptedAt,
          }
        : null,
    currentIssues,
    unresolvedIssueCount: currentIssues.length,
  };
}

/**
 * OWNER: full detail. MANAGER: timeline + issue count only (no consent
 * detail, no issue messages). STAFF / unknown: nothing.
 */
export function redactReviewViewForRole(
  view: MerchantVerificationReviewView,
  role: string,
): MerchantVerificationReviewView {
  const parsed = parseMerchantMemberRole(role);
  if (parsed === MERCHANT_MEMBER_ROLE_OWNER) {
    return view;
  }
  if (parsed === MERCHANT_MEMBER_ROLE_MANAGER) {
    return {
      submittedAt: view.submittedAt,
      reviewedAt: view.reviewedAt,
      attemptNumber: view.attemptNumber,
      legalAcceptance: null,
      currentIssues: [],
      unresolvedIssueCount: view.unresolvedIssueCount,
    };
  }
  return emptyVerificationReviewView();
}

export function toMembershipView(input: {
  member: MerchantMemberRecord;
  merchant: MerchantRecord;
  branches: MerchantBranchRecord[];
  documents: MerchantDocumentSummary[];
  includeDocuments?: boolean;
  includeChecklist?: boolean;
  branchViews?: MerchantBranchView[];
  review?: MerchantVerificationReviewView;
}): MerchantMembershipView {
  const readiness = deriveMerchantReadiness({
    name: input.merchant.name,
    status: input.merchant.status,
    verifiedAt: input.merchant.verifiedAt,
    branchOperationalStatuses: (input.branchViews ?? input.branches).map(
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
    branches:
      input.branchViews ?? input.branches.map((branch) => toBranchView(branch)),
    documents: includeDocuments ? input.documents.map(toDocumentView) : [],
    evidenceChecklist: includeChecklist
      ? buildEvidenceChecklist(input.documents)
      : [],
    ...redactReviewViewForRole(
      input.review ?? emptyVerificationReviewView(),
      input.member.role,
    ),
  };
}

export function toVerificationPackageView(input: {
  merchant: MerchantRecord;
  documents: MerchantDocumentSummary[];
  review?: MerchantVerificationReviewView;
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
    ...(input.review ?? emptyVerificationReviewView()),
  };
}

export function newPublicReference(): string {
  return `sgm_${createUuidV7().replaceAll('-', '')}`;
}
