import { createHash, randomBytes } from 'node:crypto';
import { timingSafeEqualText } from '../../../common/utils/timing-safe';
import {
  MERCHANT_MEMBER_ROLE_MANAGER,
  MERCHANT_MEMBER_ROLE_OWNER,
  MERCHANT_MEMBER_ROLE_STAFF,
  parseMerchantMemberRole,
  type MerchantMemberRole,
} from './merchant.policy';

/** Roles an OWNER may grant through team management. OWNER is never grantable. */
export const TEAM_ASSIGNABLE_ROLES = [
  MERCHANT_MEMBER_ROLE_MANAGER,
  MERCHANT_MEMBER_ROLE_STAFF,
] as const;
export type TeamAssignableRole = (typeof TEAM_ASSIGNABLE_ROLES)[number];

export const TEAM_INVITATION_STATUS_PENDING = 'PENDING';
export const TEAM_INVITATION_STATUS_ACCEPTED = 'ACCEPTED';
export const TEAM_INVITATION_STATUS_CANCELLED = 'CANCELLED';
export const TEAM_INVITATION_STATUS_EXPIRED = 'EXPIRED';

export const TEAM_INVITATION_STATUSES = [
  TEAM_INVITATION_STATUS_PENDING,
  TEAM_INVITATION_STATUS_ACCEPTED,
  TEAM_INVITATION_STATUS_CANCELLED,
  TEAM_INVITATION_STATUS_EXPIRED,
] as const;
export type TeamInvitationStatus = (typeof TEAM_INVITATION_STATUSES)[number];

export const TEAM_INVITATION_TTL_DAYS = 7;
export const TEAM_INVITATION_TTL_MS = TEAM_INVITATION_TTL_DAYS * 86_400_000;

export const TEAM_DEFAULT_PHONE_COUNTRY = 'DZ';
export const TEAM_ACCEPT_CODE_BYTES = 32;
export const TEAM_ACCEPT_CODE_HEX_LENGTH = TEAM_ACCEPT_CODE_BYTES * 2;

/** MerchantMember is merchant-wide; there is no per-branch ACL. */
export const TEAM_BRANCH_SCOPE_ALL = 'ALL_MERCHANT_BRANCHES';
export type TeamBranchScope = typeof TEAM_BRANCH_SCOPE_ALL;

/** Request keys that would imply branch-scoped access; always rejected. */
export const TEAM_BRANCH_ASSIGNMENT_KEYS = [
  'branchId',
  'branchIds',
  'branchScope',
] as const;

export function generateAcceptCode(): string {
  return randomBytes(TEAM_ACCEPT_CODE_BYTES).toString('hex');
}

export function hashAcceptCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

export function acceptCodeMatches(
  presentedCode: string,
  storedHash: string,
): boolean {
  return timingSafeEqualText(hashAcceptCode(presentedCode), storedHash);
}

export function isTeamAssignableRole(
  value: string,
): value is TeamAssignableRole {
  return (TEAM_ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

const ROLE_RANK: Record<MerchantMemberRole, number> = {
  [MERCHANT_MEMBER_ROLE_OWNER]: 3,
  [MERCHANT_MEMBER_ROLE_MANAGER]: 2,
  [MERCHANT_MEMBER_ROLE_STAFF]: 1,
};

/** True when moving from `from` to `to` removes privileges. Unknown roles fail closed. */
export function isRoleDemotion(from: string, to: string): boolean {
  const fromRole = parseMerchantMemberRole(from);
  const toRole = parseMerchantMemberRole(to);
  if (!fromRole || !toRole) {
    return true;
  }
  return ROLE_RANK[toRole] < ROLE_RANK[fromRole];
}

export function newInvitationExpiry(now: Date): Date {
  return new Date(now.getTime() + TEAM_INVITATION_TTL_MS);
}

export function isInvitationExpired(expiresAt: string, now: Date): boolean {
  return Date.parse(expiresAt) <= now.getTime();
}

export type MerchantTeamMemberRecord = {
  id: string;
  merchantId: string;
  accountId: string;
  role: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MerchantInvitationRecord = {
  id: string;
  merchantId: string;
  phone: string;
  role: string;
  status: string;
  tokenHash: string;
  expiresAt: string;
  createdByAccountId: string;
  acceptedByAccountId: string | null;
  acceptedAt: string | null;
  cancelledAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TeamMemberView = {
  id: string;
  phone: string | null;
  role: string;
  branchScope: TeamBranchScope;
  isSelf: boolean;
  version: number;
  createdAt: string;
};

export type TeamInvitationView = {
  id: string;
  phone: string;
  role: string;
  status: TeamInvitationStatus;
  expiresAt: string;
  branchScope: TeamBranchScope;
  version: number;
  createdAt: string;
};

/** Returned once at creation / regeneration; `acceptCode` is never persisted in clear. */
export type TeamInvitationIssuedView = TeamInvitationView & {
  acceptCode: string;
};

export type TeamCapabilityView = {
  canManage: boolean;
};

export type MerchantTeamView = {
  merchantId: string;
  members: TeamMemberView[];
  invitations: TeamInvitationView[];
  capabilities: TeamCapabilityView;
};

export type MyTeamInvitationView = {
  id: string;
  merchantId: string;
  merchantName: string;
  role: string;
  expiresAt: string;
  branchScope: TeamBranchScope;
  createdAt: string;
};

export type MyTeamInvitationsView = {
  invitations: MyTeamInvitationView[];
};

export type TeamBranchAssignmentProbe = Partial<
  Record<(typeof TEAM_BRANCH_ASSIGNMENT_KEYS)[number], unknown>
>;

export function hasBranchAssignment(input: TeamBranchAssignmentProbe): boolean {
  return TEAM_BRANCH_ASSIGNMENT_KEYS.some((key) => input[key] !== undefined);
}

export function toTeamInvitationView(
  record: MerchantInvitationRecord,
  now: Date,
): TeamInvitationView {
  const status =
    record.status === TEAM_INVITATION_STATUS_PENDING &&
    isInvitationExpired(record.expiresAt, now)
      ? TEAM_INVITATION_STATUS_EXPIRED
      : (record.status as TeamInvitationStatus);
  return {
    id: record.id,
    phone: record.phone,
    role: record.role,
    status,
    expiresAt: record.expiresAt,
    branchScope: TEAM_BRANCH_SCOPE_ALL,
    version: record.version,
    createdAt: record.createdAt,
  };
}

export type TeamInvitationAcceptedView = {
  merchantId: string;
  memberId: string;
  role: string;
  branchScope: TeamBranchScope;
  version: number;
  createdAt: string;
};

export type TeamMemberRevokedView = {
  memberId: string;
  revoked: true;
};
