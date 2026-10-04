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
  MERCHANT_VERIFICATION_READ: 'MERCHANT_VERIFICATION_READ',
  MERCHANT_VERIFICATION_MUTATE: 'MERCHANT_VERIFICATION_MUTATE',
  CATALOG_READ: 'CATALOG_READ',
  CATEGORY_MANAGE: 'CATEGORY_MANAGE',
  PRODUCT_MANAGE: 'PRODUCT_MANAGE',
  PRODUCT_OPTIONS_MANAGE: 'PRODUCT_OPTIONS_MANAGE',
  ORDER_READ: 'ORDER_READ',
  ORDER_WORKFLOW_MUTATE: 'ORDER_WORKFLOW_MUTATE',
  COMMISSION_READ: 'COMMISSION_READ',
  SETTLEMENT_READ: 'SETTLEMENT_READ',
  TEAM_READ: 'TEAM_READ',
  TEAM_MANAGE: 'TEAM_MANAGE',
} as const;

/**
 * SpeedyGo application evidence categories on MerchantDocument.type (VARCHAR).
 * Not Algerian statutory document names. Presence of these codes does not by
 * itself prove Algerian legal/compliance satisfaction.
 */
export const MERCHANT_DOCUMENT_BUSINESS_IDENTITY = 'BUSINESS_IDENTITY';
export const MERCHANT_DOCUMENT_BUSINESS_REGISTRATION = 'BUSINESS_REGISTRATION';
export const MERCHANT_DOCUMENT_SUPPORTING = 'SUPPORTING_DOCUMENT';

export const MERCHANT_DOCUMENT_TYPES = [
  MERCHANT_DOCUMENT_BUSINESS_IDENTITY,
  MERCHANT_DOCUMENT_BUSINESS_REGISTRATION,
  MERCHANT_DOCUMENT_SUPPORTING,
] as const;

export type MerchantDocumentType = (typeof MERCHANT_DOCUMENT_TYPES)[number];

export const MERCHANT_REQUIRED_DOCUMENT_TYPES = [
  MERCHANT_DOCUMENT_BUSINESS_IDENTITY,
  MERCHANT_DOCUMENT_BUSINESS_REGISTRATION,
] as const;

export const MERCHANT_OPTIONAL_DOCUMENT_TYPES = [
  MERCHANT_DOCUMENT_SUPPORTING,
] as const;

/** Metadata registered; not yet part of a formal review package. */
export const MERCHANT_DOCUMENT_STATUS_PENDING = 'PENDING';
/** Included in the Merchant's formal verification submission. */
export const MERCHANT_DOCUMENT_STATUS_SUBMITTED = 'SUBMITTED';

export const MERCHANT_DOCUMENT_STATUSES = [
  MERCHANT_DOCUMENT_STATUS_PENDING,
  MERCHANT_DOCUMENT_STATUS_SUBMITTED,
] as const;

export type MerchantDocumentStatus =
  (typeof MERCHANT_DOCUMENT_STATUSES)[number];

export const LEGAL_KIND_MERCHANT_TERMS = 'MERCHANT_TERMS';
export const LEGAL_KIND_DOSSIER_ACCURACY_DECLARATION =
  'DOSSIER_ACCURACY_DECLARATION';

export const LEGAL_KINDS = [
  LEGAL_KIND_MERCHANT_TERMS,
  LEGAL_KIND_DOSSIER_ACCURACY_DECLARATION,
] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];

export const LEGAL_SEED_VERSION = '2026-10-03';

export function isLegalKind(value: string): value is LegalKind {
  return (LEGAL_KINDS as readonly string[]).includes(value);
}

export const VERIFICATION_OUTCOME_PENDING_REVIEW = 'PENDING_REVIEW';
export const VERIFICATION_OUTCOME_APPROVED = 'APPROVED';
export const VERIFICATION_OUTCOME_REJECTED = 'REJECTED';

export const VERIFICATION_ISSUE_SCOPE_APPLICATION = 'APPLICATION';
export const VERIFICATION_ISSUE_SCOPE_DOCUMENT = 'DOCUMENT';

export const VERIFICATION_ISSUE_SCOPES = [
  VERIFICATION_ISSUE_SCOPE_APPLICATION,
  VERIFICATION_ISSUE_SCOPE_DOCUMENT,
] as const;
export type VerificationIssueScope = (typeof VERIFICATION_ISSUE_SCOPES)[number];

export const VERIFICATION_APPLICATION_ISSUE_CODES = [
  'PROFILE_INCOMPLETE',
  'IDENTITY_MISMATCH',
  'OTHER_APPLICATION',
] as const;

export const VERIFICATION_DOCUMENT_ISSUE_CODES = [
  'DOCUMENT_MISSING',
  'DOCUMENT_ILLEGIBLE',
  'DOCUMENT_EXPIRED',
  'DOCUMENT_MISMATCH',
  'OTHER_DOCUMENT',
] as const;

export const VERIFICATION_ISSUE_MESSAGE_MAX_LENGTH = 500;
export const VERIFICATION_ISSUES_MAX_COUNT = 20;

export type RejectionIssueInput = {
  scope: string;
  code: string;
  messageFr: string;
  documentType?: string | null;
};

export type ValidatedRejectionIssue = {
  scope: VerificationIssueScope;
  code: string;
  messageFr: string;
  documentType: string | null;
};

export type RejectionIssuesValidation =
  | { ok: true; issues: ValidatedRejectionIssue[] }
  | { ok: false; message: string };

/**
 * Pure validation of an Admin rejection payload. `existingDocumentTypes` are
 * the MerchantDocument.type values currently held by the Merchant.
 */
export function validateRejectionIssues(
  issues: readonly RejectionIssueInput[] | null | undefined,
  existingDocumentTypes: readonly string[],
): RejectionIssuesValidation {
  if (!issues || issues.length === 0) {
    return { ok: false, message: 'At least one rejection issue is required' };
  }
  if (issues.length > VERIFICATION_ISSUES_MAX_COUNT) {
    return {
      ok: false,
      message: `At most ${VERIFICATION_ISSUES_MAX_COUNT} rejection issues are allowed`,
    };
  }
  const validated: ValidatedRejectionIssue[] = [];
  for (const issue of issues) {
    const messageFr =
      typeof issue.messageFr === 'string' ? issue.messageFr.trim() : '';
    if (
      messageFr.length === 0 ||
      messageFr.length > VERIFICATION_ISSUE_MESSAGE_MAX_LENGTH
    ) {
      return {
        ok: false,
        message: `messageFr must be 1-${VERIFICATION_ISSUE_MESSAGE_MAX_LENGTH} characters`,
      };
    }
    if (issue.scope === VERIFICATION_ISSUE_SCOPE_APPLICATION) {
      if (
        !(VERIFICATION_APPLICATION_ISSUE_CODES as readonly string[]).includes(
          issue.code,
        )
      ) {
        return { ok: false, message: 'Unsupported APPLICATION issue code' };
      }
      if (issue.documentType) {
        return {
          ok: false,
          message: 'APPLICATION issues must not carry a documentType',
        };
      }
      validated.push({
        scope: VERIFICATION_ISSUE_SCOPE_APPLICATION,
        code: issue.code,
        messageFr,
        documentType: null,
      });
      continue;
    }
    if (issue.scope === VERIFICATION_ISSUE_SCOPE_DOCUMENT) {
      if (
        !(VERIFICATION_DOCUMENT_ISSUE_CODES as readonly string[]).includes(
          issue.code,
        )
      ) {
        return { ok: false, message: 'Unsupported DOCUMENT issue code' };
      }
      if (
        !issue.documentType ||
        !isMerchantDocumentType(issue.documentType) ||
        !existingDocumentTypes.includes(issue.documentType)
      ) {
        return {
          ok: false,
          message:
            'DOCUMENT issues require a documentType held by the Merchant',
        };
      }
      validated.push({
        scope: VERIFICATION_ISSUE_SCOPE_DOCUMENT,
        code: issue.code,
        messageFr,
        documentType: issue.documentType,
      });
      continue;
    }
    return { ok: false, message: 'Unsupported issue scope' };
  }
  return { ok: true, issues: validated };
}

export type LegalAcceptanceInput = { kind: string; version: string };

export type LegalAcceptanceEvaluation =
  | { ok: true; acceptances: Array<{ kind: LegalKind; version: string }> }
  | { ok: false; reason: 'REQUIRED' | 'OUTDATED'; message: string };

/**
 * Both active legal kinds must be accepted at their exact current version.
 * `currentVersions` maps kind -> active version string.
 */
export function evaluateLegalAcceptances(
  acceptances: readonly LegalAcceptanceInput[] | null | undefined,
  currentVersions: ReadonlyMap<string, string>,
): LegalAcceptanceEvaluation {
  if (!acceptances || acceptances.length === 0) {
    return {
      ok: false,
      reason: 'REQUIRED',
      message: 'Acceptance of the current legal documents is required',
    };
  }
  for (const row of acceptances) {
    if (!isLegalKind(row.kind)) {
      return {
        ok: false,
        reason: 'REQUIRED',
        message: 'Unsupported legal document kind',
      };
    }
  }
  const resolved: Array<{ kind: LegalKind; version: string }> = [];
  for (const kind of LEGAL_KINDS) {
    const current = currentVersions.get(kind);
    if (!current) {
      return {
        ok: false,
        reason: 'REQUIRED',
        message: `No active legal version is published for ${kind}`,
      };
    }
    const matching = acceptances.filter((row) => row.kind === kind);
    if (matching.length === 0) {
      return {
        ok: false,
        reason: 'REQUIRED',
        message: `Acceptance of ${kind} is required`,
      };
    }
    if (matching.some((row) => row.version !== current)) {
      return {
        ok: false,
        reason: 'OUTDATED',
        message: `${kind} version is outdated; current version is ${current}`,
      };
    }
    resolved.push({ kind, version: current });
  }
  return { ok: true, acceptances: resolved };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isMerchantDocumentType(
  value: string,
): value is MerchantDocumentType {
  return (MERCHANT_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function isRequiredMerchantDocumentType(value: string): boolean {
  return (MERCHANT_REQUIRED_DOCUMENT_TYPES as readonly string[]).includes(
    value,
  );
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    value === parsed.toISOString().slice(0, 10)
  );
}

export function utcTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isExpiryValid(
  expiryDate: string | null,
  today = utcTodayIsoDate(),
): boolean {
  if (!expiryDate) {
    return false;
  }
  return isIsoDate(expiryDate) && expiryDate >= today;
}

export function isOptionalExpiryValid(
  expiryDate: string | null,
  today = utcTodayIsoDate(),
): boolean {
  if (!expiryDate) {
    return true;
  }
  return isExpiryValid(expiryDate, today);
}

export function objectKeyForMerchantDocument(documentId: string): string {
  return `sg-object:merchant-document:${documentId}`;
}

export type MerchantDocumentEvidence = {
  type: string;
  status: string;
  expiryDate: string | null;
};

export function findDocumentByType(
  documents: MerchantDocumentEvidence[],
  type: string,
): MerchantDocumentEvidence | null {
  const matches = documents.filter((document) => document.type === type);
  if (matches.length !== 1) {
    return null;
  }
  return matches[0] ?? null;
}

export function hasDuplicateDocumentTypes(
  documents: Array<{ type: string }>,
): boolean {
  const seen = new Set<string>();
  for (const document of documents) {
    if (seen.has(document.type)) {
      return true;
    }
    seen.add(document.type);
  }
  return false;
}

export function isBusinessIdentityComplete(
  input: MerchantDocumentEvidence | null,
  today = utcTodayIsoDate(),
): boolean {
  return Boolean(
    input &&
    input.type === MERCHANT_DOCUMENT_BUSINESS_IDENTITY &&
    isOptionalExpiryValid(input.expiryDate, today),
  );
}

export function isBusinessRegistrationComplete(
  input: MerchantDocumentEvidence | null,
  today = utcTodayIsoDate(),
): boolean {
  return Boolean(
    input &&
    input.type === MERCHANT_DOCUMENT_BUSINESS_REGISTRATION &&
    isOptionalExpiryValid(input.expiryDate, today),
  );
}

/**
 * SpeedyGo v1.0: expiryDate is optional for every application evidence category.
 * No frozen project authority requires BUSINESS_REGISTRATION expiry.
 * When present, expiry must be valid (>= authoritative decision date).
 */
export function isEvidenceDocumentComplete(
  input: MerchantDocumentEvidence | null,
  expectedType: string,
  today = utcTodayIsoDate(),
): boolean {
  return Boolean(
    input &&
    input.type === expectedType &&
    isOptionalExpiryValid(input.expiryDate, today),
  );
}

export function isVerificationReady(input: {
  name: string;
  documents: MerchantDocumentEvidence[];
  today?: string;
}): boolean {
  if (hasDuplicateDocumentTypes(input.documents)) {
    return false;
  }
  const today = input.today ?? utcTodayIsoDate();
  return (
    isMerchantProfileComplete(input.name) &&
    isEvidenceDocumentComplete(
      findDocumentByType(input.documents, MERCHANT_DOCUMENT_BUSINESS_IDENTITY),
      MERCHANT_DOCUMENT_BUSINESS_IDENTITY,
      today,
    ) &&
    isEvidenceDocumentComplete(
      findDocumentByType(
        input.documents,
        MERCHANT_DOCUMENT_BUSINESS_REGISTRATION,
      ),
      MERCHANT_DOCUMENT_BUSINESS_REGISTRATION,
      today,
    )
  );
}

/**
 * Formal submission is represented by required documents at SUBMITTED.
 * Merchant.status alone cannot distinguish incomplete vs submitted
 * because create already sets PENDING_REVIEW.
 */
export function isVerificationFormallySubmitted(
  documents: MerchantDocumentEvidence[],
): boolean {
  if (hasDuplicateDocumentTypes(documents)) {
    return false;
  }
  return MERCHANT_REQUIRED_DOCUMENT_TYPES.every((type) => {
    const document = findDocumentByType(documents, type);
    return (
      document !== null &&
      document.status === MERCHANT_DOCUMENT_STATUS_SUBMITTED
    );
  });
}

export function canEditVerificationEvidence(input: {
  status: string;
  documents: MerchantDocumentEvidence[];
}): boolean {
  if (input.status === MERCHANT_STATUS_REJECTED) {
    return true;
  }
  if (input.status === MERCHANT_STATUS_PENDING_REVIEW) {
    return !isVerificationFormallySubmitted(input.documents);
  }
  return false;
}

export function canSubmitMerchantVerification(status: string): boolean {
  return (
    status === MERCHANT_STATUS_PENDING_REVIEW ||
    status === MERCHANT_STATUS_REJECTED
  );
}

export function isRequiredDocumentExpiredAttention(input: {
  status: string;
  verifiedAt: string | null;
  documents: MerchantDocumentEvidence[];
  today?: string;
}): boolean {
  if (!isMerchantApproved(input.status, input.verifiedAt)) {
    return false;
  }
  if (hasDuplicateDocumentTypes(input.documents)) {
    return true;
  }
  const today = input.today ?? utcTodayIsoDate();
  return MERCHANT_REQUIRED_DOCUMENT_TYPES.some((type) => {
    const document = findDocumentByType(input.documents, type);
    if (!document) {
      return true;
    }
    return !isOptionalExpiryValid(document.expiryDate, today);
  });
}

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
    case MERCHANT_CAPABILITIES.COMMISSION_READ:
    case MERCHANT_CAPABILITIES.SETTLEMENT_READ:
    case MERCHANT_CAPABILITIES.MERCHANT_VERIFICATION_READ:
      return (
        role === MERCHANT_MEMBER_ROLE_OWNER ||
        role === MERCHANT_MEMBER_ROLE_MANAGER
      );
    case MERCHANT_CAPABILITIES.TEAM_READ:
      return (
        role === MERCHANT_MEMBER_ROLE_OWNER ||
        role === MERCHANT_MEMBER_ROLE_MANAGER
      );
    case MERCHANT_CAPABILITIES.MERCHANT_PROFILE_UPDATE:
    case MERCHANT_CAPABILITIES.MERCHANT_VERIFICATION_MUTATE:
    case MERCHANT_CAPABILITIES.TEAM_MANAGE:
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

export type MerchantFinanceAccess = 'GRANTED' | 'ROLE_RESTRICTED';

/**
 * Single Merchant financial-visibility rule shared by Orders and Reports.
 * Commission (rate and amount), merchant net, merchant discount, settlement
 * and refund adjustments require both COMMISSION_READ and SETTLEMENT_READ
 * (OWNER, MANAGER). STAFF keeps operational data, merchandise sales, item
 * prices, quantities and rankings. See docs/architecture/MERCHANT_FINANCIAL_VISIBILITY.md.
 */
export function merchantRoleHasFinanceAccess(
  role: MerchantMemberRole | null,
): boolean {
  return (
    role !== null &&
    roleHasCapability(role, MERCHANT_CAPABILITIES.COMMISSION_READ) &&
    roleHasCapability(role, MERCHANT_CAPABILITIES.SETTLEMENT_READ)
  );
}

export function merchantFinanceAccess(
  role: MerchantMemberRole | null,
): MerchantFinanceAccess {
  return merchantRoleHasFinanceAccess(role) ? 'GRANTED' : 'ROLE_RESTRICTED';
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

export const BRANCH_DESCRIPTION_MAX_LENGTH = 2000;
export const BRANCH_NAME_AR_MAX_LENGTH = 255;
export const BRANCH_PUBLIC_EMAIL_MAX_LENGTH = 255;

const BRANCH_PUBLIC_EMAIL_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/**
 * Trims; empty string collapses to null (clear). Returns undefined when the
 * field is not part of the request. Throws a plain Error message via the
 * supplied factory when the length cap is exceeded.
 */
export function normalizeOptionalBranchText(
  value: string | null | undefined,
  maxLength: number,
  onInvalid: (message: string) => Error,
  field: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw onInvalid(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

export function normalizeOptionalPublicEmail(
  value: string | null | undefined,
  onInvalid: (message: string) => Error,
): string | null | undefined {
  const trimmed = normalizeOptionalBranchText(
    value,
    BRANCH_PUBLIC_EMAIL_MAX_LENGTH,
    onInvalid,
    'publicEmail',
  );
  if (trimmed === undefined || trimmed === null) {
    return trimmed;
  }
  if (!BRANCH_PUBLIC_EMAIL_PATTERN.test(trimmed)) {
    throw onInvalid('publicEmail must be a valid email address');
  }
  return trimmed;
}
