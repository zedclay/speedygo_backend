import { Injectable } from '@nestjs/common';
import { normalizePhone } from '../../auth/domain/identity';
import { SessionService } from '../../auth/application/session.service';
import {
  teamDuplicateMember,
  teamInviteCodeInvalid,
  teamInviteExpired,
  teamInviteNotFound,
  teamInvalidInput,
  teamMemberNotFound,
  teamOwnerProtected,
  teamPhoneMismatch,
  teamSelfForbidden,
  teamVersionConflict,
} from '../domain/merchant.errors';
import {
  MERCHANT_CAPABILITIES,
  MERCHANT_MEMBER_ROLE_OWNER,
  parseMerchantMemberRole,
  roleHasCapability,
} from '../domain/merchant.policy';
import {
  TEAM_BRANCH_SCOPE_ALL,
  TEAM_DEFAULT_PHONE_COUNTRY,
  TEAM_INVITATION_STATUS_PENDING,
  acceptCodeMatches,
  generateAcceptCode,
  hasBranchAssignment,
  hashAcceptCode,
  isInvitationExpired,
  isRoleDemotion,
  isTeamAssignableRole,
  newInvitationExpiry,
  toTeamInvitationView,
  type MerchantInvitationRecord,
  type MerchantTeamMemberRecord,
  type MerchantTeamView,
  type MyTeamInvitationsView,
  type TeamBranchAssignmentProbe,
  type TeamInvitationAcceptedView,
  type TeamInvitationIssuedView,
  type TeamInvitationView,
  type TeamMemberRevokedView,
  type TeamMemberView,
} from '../domain/merchant-team.types';
import { MerchantRepository } from '../infrastructure/merchant.repository';
import { MerchantTeamRepository } from '../infrastructure/merchant-team.repository';
import { MerchantAccessService } from './merchant-access.service';

export type CreateTeamInvitationInput = TeamBranchAssignmentProbe & {
  phone: string;
  role: string;
};

export type UpdateTeamMemberInput = TeamBranchAssignmentProbe & {
  role: string;
  expectedVersion: number;
};

function assertExpectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw teamInvalidInput('expectedVersion must be a positive integer');
  }
  return value;
}

function assertNoBranchAssignment(input: TeamBranchAssignmentProbe): void {
  if (hasBranchAssignment(input)) {
    throw teamInvalidInput(
      'Team access is merchant-wide; branch assignment is not supported',
    );
  }
}

/**
 * Merchant Team Management (docs/architecture/MERCHANT_TEAM_MANAGEMENT.md).
 * Authorization lives in MerchantAccessService via TEAM_READ / TEAM_MANAGE.
 * The accept code is returned once, stored only as a SHA-256 hash, and is
 * never logged.
 */
@Injectable()
export class MerchantTeamService {
  constructor(
    private readonly access: MerchantAccessService,
    private readonly team: MerchantTeamRepository,
    private readonly merchants: MerchantRepository,
    private readonly sessions: SessionService,
  ) {}

  async getTeam(
    accountId: string,
    merchantId: string,
    now: Date = new Date(),
  ): Promise<MerchantTeamView> {
    const context = await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.TEAM_READ,
    );
    const role = parseMerchantMemberRole(context.member.role);
    const [members, pending] = await Promise.all([
      this.team.listMembers(merchantId),
      this.team.listPendingInvitations(merchantId),
    ]);
    const phones = await this.team.listAccountPhones(
      members.map((member) => member.accountId),
    );
    return {
      merchantId,
      members: members.map((member) =>
        this.toMemberView(
          member,
          phones.get(member.accountId) ?? null,
          accountId,
        ),
      ),
      invitations: pending.map((invitation) =>
        toTeamInvitationView(invitation, now),
      ),
      capabilities: {
        canManage:
          role !== null &&
          roleHasCapability(role, MERCHANT_CAPABILITIES.TEAM_MANAGE),
      },
    };
  }

  async createInvitation(
    accountId: string,
    merchantId: string,
    input: CreateTeamInvitationInput,
    now: Date = new Date(),
  ): Promise<TeamInvitationIssuedView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.TEAM_MANAGE,
    );
    assertNoBranchAssignment(input);
    const phone = this.normalizeInvitePhone(input.phone);
    const role = this.parseAssignableRole(input.role);

    const existingAccountId = await this.team.findAccountIdByPhone(phone);
    if (existingAccountId) {
      const existingMember = await this.team.findMemberByAccount(
        merchantId,
        existingAccountId,
      );
      if (existingMember) {
        throw teamDuplicateMember();
      }
    }

    const acceptCode = generateAcceptCode();
    const invitation = await this.team.createInvitation({
      merchantId,
      phone,
      role,
      tokenHash: hashAcceptCode(acceptCode),
      expiresAt: newInvitationExpiry(now),
      createdByAccountId: accountId,
      now,
    });
    return { ...toTeamInvitationView(invitation, now), acceptCode };
  }

  async cancelInvitation(
    accountId: string,
    merchantId: string,
    invitationId: string,
    expectedVersion: number,
    now: Date = new Date(),
  ): Promise<TeamInvitationView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.TEAM_MANAGE,
    );
    const version = assertExpectedVersion(expectedVersion);
    const invitation = await this.requirePendingInvitation(
      merchantId,
      invitationId,
    );
    if (invitation.version !== version) {
      throw teamVersionConflict();
    }
    const cancelled = await this.team.cancelInvitation({
      merchantId,
      invitationId,
      expectedVersion: version,
    });
    if (!cancelled) {
      throw teamVersionConflict();
    }
    return toTeamInvitationView(cancelled, now);
  }

  async regenerateInvitationCode(
    accountId: string,
    merchantId: string,
    invitationId: string,
    expectedVersion: number,
    now: Date = new Date(),
  ): Promise<TeamInvitationIssuedView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.TEAM_MANAGE,
    );
    const version = assertExpectedVersion(expectedVersion);
    const invitation = await this.requirePendingInvitation(
      merchantId,
      invitationId,
    );
    if (invitation.version !== version) {
      throw teamVersionConflict();
    }
    const acceptCode = generateAcceptCode();
    const regenerated = await this.team.regenerateInvitation({
      merchantId,
      invitationId,
      expectedVersion: version,
      tokenHash: hashAcceptCode(acceptCode),
      expiresAt: newInvitationExpiry(now),
    });
    if (!regenerated) {
      throw teamVersionConflict();
    }
    return { ...toTeamInvitationView(regenerated, now), acceptCode };
  }

  async updateMemberRole(
    accountId: string,
    merchantId: string,
    memberId: string,
    input: UpdateTeamMemberInput,
  ): Promise<TeamMemberView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.TEAM_MANAGE,
    );
    assertNoBranchAssignment(input);
    const role = this.parseAssignableRole(input.role);
    const version = assertExpectedVersion(input.expectedVersion);
    const target = await this.requireMutableMember(
      accountId,
      merchantId,
      memberId,
    );
    if (target.version !== version) {
      throw teamVersionConflict();
    }
    if (target.role === role) {
      return this.viewMember(target, accountId);
    }
    const updated = await this.team.updateMemberRole({
      merchantId,
      memberId,
      expectedVersion: version,
      role,
    });
    if (!updated) {
      throw teamVersionConflict();
    }
    if (isRoleDemotion(target.role, updated.role)) {
      await this.sessions.revokeAllSessionsForAccount(target.accountId);
    }
    return this.viewMember(updated, accountId);
  }

  async revokeMember(
    accountId: string,
    merchantId: string,
    memberId: string,
    expectedVersion: number,
  ): Promise<TeamMemberRevokedView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.TEAM_MANAGE,
    );
    const version = assertExpectedVersion(expectedVersion);
    const target = await this.requireMutableMember(
      accountId,
      merchantId,
      memberId,
    );
    if (target.version !== version) {
      throw teamVersionConflict();
    }
    const deleted = await this.team.deleteMember({
      merchantId,
      memberId,
      expectedVersion: version,
    });
    if (!deleted) {
      throw teamVersionConflict();
    }
    await this.sessions.revokeAllSessionsForAccount(target.accountId);
    return { memberId, revoked: true };
  }

  async listMyInvitations(
    accountId: string,
    now: Date = new Date(),
  ): Promise<MyTeamInvitationsView> {
    const phone = await this.team.findAccountPhone(accountId);
    if (!phone) {
      return { invitations: [] };
    }
    const pending = (
      await this.team.listPendingInvitationsByPhone(phone)
    ).filter((invitation) => !isInvitationExpired(invitation.expiresAt, now));
    const merchants = await this.merchants.findMerchantsByIds([
      ...new Set(pending.map((invitation) => invitation.merchantId)),
    ]);
    const names = new Map(
      merchants.map((merchant) => [merchant.id, merchant.name]),
    );
    return {
      invitations: pending
        .filter((invitation) => names.has(invitation.merchantId))
        .map((invitation) => ({
          id: invitation.id,
          merchantId: invitation.merchantId,
          merchantName: names.get(invitation.merchantId) ?? '',
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          branchScope: TEAM_BRANCH_SCOPE_ALL,
          createdAt: invitation.createdAt,
        })),
    };
  }

  async acceptInvitation(
    accountId: string,
    invitationId: string,
    acceptCode: string,
    now: Date = new Date(),
  ): Promise<TeamInvitationAcceptedView> {
    const invitation = await this.team.findInvitationById(invitationId);
    if (!invitation || invitation.status !== TEAM_INVITATION_STATUS_PENDING) {
      throw teamInviteNotFound();
    }
    const phone = await this.team.findAccountPhone(accountId);
    if (!phone || phone !== invitation.phone) {
      throw teamPhoneMismatch();
    }
    if (isInvitationExpired(invitation.expiresAt, now)) {
      throw teamInviteExpired();
    }
    if (
      typeof acceptCode !== 'string' ||
      acceptCode.length === 0 ||
      !acceptCodeMatches(acceptCode, invitation.tokenHash)
    ) {
      throw teamInviteCodeInvalid();
    }
    const role = parseMerchantMemberRole(invitation.role);
    if (!role || role === MERCHANT_MEMBER_ROLE_OWNER) {
      throw teamOwnerProtected();
    }
    const merchant = await this.merchants.findMerchant(invitation.merchantId);
    if (!merchant) {
      throw teamInviteNotFound();
    }
    const existing = await this.team.findMemberByAccount(
      invitation.merchantId,
      accountId,
    );
    if (existing) {
      throw teamDuplicateMember();
    }
    const member = await this.team.acceptInvitation({ invitation, accountId });
    return {
      merchantId: member.merchantId,
      memberId: member.id,
      role: member.role,
      branchScope: TEAM_BRANCH_SCOPE_ALL,
      version: member.version,
      createdAt: member.createdAt,
    };
  }

  private normalizeInvitePhone(raw: unknown): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw teamInvalidInput('phone is required');
    }
    try {
      return normalizePhone(raw, TEAM_DEFAULT_PHONE_COUNTRY);
    } catch {
      throw teamInvalidInput('phone must be a valid phone number');
    }
  }

  private parseAssignableRole(raw: unknown): 'MANAGER' | 'STAFF' {
    if (typeof raw !== 'string') {
      throw teamInvalidInput('role must be MANAGER or STAFF');
    }
    if (raw === MERCHANT_MEMBER_ROLE_OWNER) {
      throw teamOwnerProtected();
    }
    if (!isTeamAssignableRole(raw)) {
      throw teamInvalidInput('role must be MANAGER or STAFF');
    }
    return raw;
  }

  private async requirePendingInvitation(
    merchantId: string,
    invitationId: string,
  ): Promise<MerchantInvitationRecord> {
    const invitation = await this.team.findInvitationForMerchant(
      merchantId,
      invitationId,
    );
    if (!invitation || invitation.status !== TEAM_INVITATION_STATUS_PENDING) {
      throw teamInviteNotFound();
    }
    return invitation;
  }

  /** Target must exist in this Merchant, not be the actor, and not be an OWNER. */
  private async requireMutableMember(
    actorAccountId: string,
    merchantId: string,
    memberId: string,
  ): Promise<MerchantTeamMemberRecord> {
    const target = await this.team.findMemberById(merchantId, memberId);
    if (!target) {
      throw teamMemberNotFound();
    }
    if (target.accountId === actorAccountId) {
      throw teamSelfForbidden();
    }
    if (target.role === MERCHANT_MEMBER_ROLE_OWNER) {
      throw teamOwnerProtected();
    }
    return target;
  }

  private async viewMember(
    member: MerchantTeamMemberRecord,
    viewerAccountId: string,
  ): Promise<TeamMemberView> {
    const phone = await this.team.findAccountPhone(member.accountId);
    return this.toMemberView(member, phone, viewerAccountId);
  }

  private toMemberView(
    member: MerchantTeamMemberRecord,
    phone: string | null,
    viewerAccountId: string,
  ): TeamMemberView {
    return {
      id: member.id,
      phone,
      role: member.role,
      branchScope: TEAM_BRANCH_SCOPE_ALL,
      isSelf: member.accountId === viewerAccountId,
      version: member.version,
      createdAt: member.createdAt,
    };
  }
}
