import { Injectable } from '@nestjs/common';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgNow,
  pgTimestamptz,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import {
  teamDuplicateInvite,
  teamDuplicateMember,
  teamInviteNotFound,
  teamVersionConflict,
} from '../domain/merchant.errors';
import {
  TEAM_INVITATION_STATUS_ACCEPTED,
  TEAM_INVITATION_STATUS_CANCELLED,
  TEAM_INVITATION_STATUS_EXPIRED,
  TEAM_INVITATION_STATUS_PENDING,
  isInvitationExpired,
  type MerchantInvitationRecord,
  type MerchantTeamMemberRecord,
} from '../domain/merchant-team.types';

type OrmClient = { orm: SpeedyGoDb['orm'] };

function orm(client: OrmClient) {
  return client.orm.public;
}

type MemberRow = {
  id: string;
  merchantId: string;
  accountId: string;
  role: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type InvitationRow = {
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

@Injectable()
export class MerchantTeamRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async listMembers(merchantId: string): Promise<MerchantTeamMemberRecord[]> {
    const rows = await orm(this.db())
      .MerchantMember.where({ merchantId })
      .orderBy((member) => member.createdAt.asc())
      .all();
    return rows.map((row) => this.toMember(row));
  }

  async findMemberById(
    merchantId: string,
    memberId: string,
  ): Promise<MerchantTeamMemberRecord | null> {
    const row = await orm(this.db())
      .MerchantMember.where({ id: memberId, merchantId })
      .first();
    return row ? this.toMember(row) : null;
  }

  async findMemberByAccount(
    merchantId: string,
    accountId: string,
  ): Promise<MerchantTeamMemberRecord | null> {
    const row = await orm(this.db())
      .MerchantMember.where({ merchantId, accountId })
      .first();
    return row ? this.toMember(row) : null;
  }

  /** Optimistic role change. Returns the updated row, or null when stale/missing. */
  async updateMemberRole(input: {
    merchantId: string;
    memberId: string;
    expectedVersion: number;
    role: string;
  }): Promise<MerchantTeamMemberRecord | null> {
    const count = await orm(this.db())
      .MerchantMember.where({
        id: input.memberId,
        merchantId: input.merchantId,
        version: input.expectedVersion,
      })
      .updateAndCount({
        role: pgVarchar<64>(input.role),
        version: input.expectedVersion + 1,
        updatedAt: pgNow(),
      });
    if (count !== 1) {
      return null;
    }
    return this.findMemberById(input.merchantId, input.memberId);
  }

  /** Optimistic revoke of one Merchant's MerchantMember row only. */
  async deleteMember(input: {
    merchantId: string;
    memberId: string;
    expectedVersion: number;
  }): Promise<boolean> {
    const count = await orm(this.db())
      .MerchantMember.where({
        id: input.memberId,
        merchantId: input.merchantId,
        version: input.expectedVersion,
      })
      .deleteAndCount();
    return count === 1;
  }

  async listAccountPhones(
    accountIds: string[],
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (accountIds.length === 0) {
      return result;
    }
    const rows = await orm(this.db())
      .Account.where((account) => account.id.in(accountIds))
      .all();
    for (const row of rows) {
      result.set(row.id, row.phone);
    }
    return result;
  }

  async findAccountIdByPhone(phone: string): Promise<string | null> {
    const row = await orm(this.db())
      .Account.where({ phone: pgVarchar<32>(phone) })
      .first();
    return row ? row.id : null;
  }

  async findAccountPhone(accountId: string): Promise<string | null> {
    const row = await orm(this.db()).Account.where({ id: accountId }).first();
    return row?.phone ?? null;
  }

  async listPendingInvitations(
    merchantId: string,
  ): Promise<MerchantInvitationRecord[]> {
    const rows = await orm(this.db())
      .MerchantMemberInvitation.where({
        merchantId,
        status: pgVarchar<64>(TEAM_INVITATION_STATUS_PENDING),
      })
      .orderBy((invitation) => invitation.createdAt.asc())
      .all();
    return rows.map((row) => this.toInvitation(row));
  }

  async listPendingInvitationsByPhone(
    phone: string,
  ): Promise<MerchantInvitationRecord[]> {
    const rows = await orm(this.db())
      .MerchantMemberInvitation.where({
        phone: pgVarchar<32>(phone),
        status: pgVarchar<64>(TEAM_INVITATION_STATUS_PENDING),
      })
      .orderBy((invitation) => invitation.createdAt.asc())
      .all();
    return rows.map((row) => this.toInvitation(row));
  }

  async findInvitationById(
    invitationId: string,
  ): Promise<MerchantInvitationRecord | null> {
    const row = await orm(this.db())
      .MerchantMemberInvitation.where({ id: invitationId })
      .first();
    return row ? this.toInvitation(row) : null;
  }

  async findInvitationForMerchant(
    merchantId: string,
    invitationId: string,
  ): Promise<MerchantInvitationRecord | null> {
    const row = await orm(this.db())
      .MerchantMemberInvitation.where({ id: invitationId, merchantId })
      .first();
    return row ? this.toInvitation(row) : null;
  }

  /**
   * Creates a PENDING invitation. An unexpired PENDING row for the same
   * (merchantId, phone) is a duplicate; an expired one is closed as EXPIRED
   * first so the partial unique index does not block the replacement.
   */
  async createInvitation(input: {
    merchantId: string;
    phone: string;
    role: string;
    tokenHash: string;
    expiresAt: Date;
    createdByAccountId: string;
    now: Date;
  }): Promise<MerchantInvitationRecord> {
    try {
      return await this.db().transaction(async (tx) => {
        const existing = await orm(tx)
          .MerchantMemberInvitation.where({
            merchantId: input.merchantId,
            phone: pgVarchar<32>(input.phone),
            status: pgVarchar<64>(TEAM_INVITATION_STATUS_PENDING),
          })
          .first();
        if (existing) {
          if (!isInvitationExpired(existing.expiresAt, input.now)) {
            throw teamDuplicateInvite();
          }
          await orm(tx)
            .MerchantMemberInvitation.where({
              id: existing.id,
              version: existing.version,
            })
            .updateAndCount({
              status: pgVarchar<64>(TEAM_INVITATION_STATUS_EXPIRED),
              version: existing.version + 1,
              updatedAt: pgNow(),
            });
        }
        const now = pgNow();
        const created = await orm(tx).MerchantMemberInvitation.create({
          id: createUuidV7(),
          merchantId: input.merchantId,
          phone: pgVarchar<32>(input.phone),
          role: pgVarchar<64>(input.role),
          status: pgVarchar<64>(TEAM_INVITATION_STATUS_PENDING),
          tokenHash: pgVarchar<128>(input.tokenHash),
          expiresAt: pgTimestamptz(input.expiresAt.toISOString()),
          createdByAccountId: input.createdByAccountId,
          acceptedByAccountId: null,
          acceptedAt: null,
          cancelledAt: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        return this.toInvitation(created);
      });
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw teamDuplicateInvite();
      }
      throw error;
    }
  }

  /** PENDING -> CANCELLED, guarded by version. Null when stale or no longer PENDING. */
  async cancelInvitation(input: {
    merchantId: string;
    invitationId: string;
    expectedVersion: number;
  }): Promise<MerchantInvitationRecord | null> {
    const now = pgNow();
    const count = await orm(this.db())
      .MerchantMemberInvitation.where({
        id: input.invitationId,
        merchantId: input.merchantId,
        status: pgVarchar<64>(TEAM_INVITATION_STATUS_PENDING),
        version: input.expectedVersion,
      })
      .updateAndCount({
        status: pgVarchar<64>(TEAM_INVITATION_STATUS_CANCELLED),
        cancelledAt: now,
        version: input.expectedVersion + 1,
        updatedAt: now,
      });
    if (count !== 1) {
      return null;
    }
    return this.findInvitationForMerchant(input.merchantId, input.invitationId);
  }

  /** New code hash + fresh expiry on a PENDING row, guarded by version. */
  async regenerateInvitation(input: {
    merchantId: string;
    invitationId: string;
    expectedVersion: number;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<MerchantInvitationRecord | null> {
    const count = await orm(this.db())
      .MerchantMemberInvitation.where({
        id: input.invitationId,
        merchantId: input.merchantId,
        status: pgVarchar<64>(TEAM_INVITATION_STATUS_PENDING),
        version: input.expectedVersion,
      })
      .updateAndCount({
        tokenHash: pgVarchar<128>(input.tokenHash),
        expiresAt: pgTimestamptz(input.expiresAt.toISOString()),
        version: input.expectedVersion + 1,
        updatedAt: pgNow(),
      });
    if (count !== 1) {
      return null;
    }
    return this.findInvitationForMerchant(input.merchantId, input.invitationId);
  }

  /**
   * Single-use accept: closes the PENDING invitation (version-guarded) and
   * creates the MerchantMember in one transaction.
   */
  async acceptInvitation(input: {
    invitation: MerchantInvitationRecord;
    accountId: string;
  }): Promise<MerchantTeamMemberRecord> {
    const { invitation, accountId } = input;
    try {
      return await this.db().transaction(async (tx) => {
        const now = pgNow();
        const count = await orm(tx)
          .MerchantMemberInvitation.where({
            id: invitation.id,
            status: pgVarchar<64>(TEAM_INVITATION_STATUS_PENDING),
            version: invitation.version,
          })
          .updateAndCount({
            status: pgVarchar<64>(TEAM_INVITATION_STATUS_ACCEPTED),
            acceptedByAccountId: accountId,
            acceptedAt: now,
            version: invitation.version + 1,
            updatedAt: now,
          });
        if (count !== 1) {
          const current = await orm(tx)
            .MerchantMemberInvitation.where({ id: invitation.id })
            .first();
          if (!current || current.status !== TEAM_INVITATION_STATUS_PENDING) {
            throw teamInviteNotFound();
          }
          throw teamVersionConflict();
        }
        const member = await orm(tx).MerchantMember.create({
          id: createUuidV7(),
          merchantId: invitation.merchantId,
          accountId,
          role: pgVarchar<64>(invitation.role),
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        return this.toMember(member);
      });
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw teamDuplicateMember();
      }
      throw error;
    }
  }

  private toMember(row: MemberRow): MerchantTeamMemberRecord {
    return {
      id: row.id,
      merchantId: row.merchantId,
      accountId: row.accountId,
      role: row.role,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toInvitation(row: InvitationRow): MerchantInvitationRecord {
    return {
      id: row.id,
      merchantId: row.merchantId,
      phone: row.phone,
      role: row.role,
      status: row.status,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      createdByAccountId: row.createdByAccountId,
      acceptedByAccountId: row.acceptedByAccountId,
      acceptedAt: row.acceptedAt,
      cancelledAt: row.cancelledAt,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
