import { Injectable } from '@nestjs/common';
import {
  isPostgresForeignKeyViolation,
  isPostgresUniqueViolation,
} from '../../../common/errors/postgres-unique';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgNow,
  pgNumeric,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import {
  merchantBranchInvalid,
  merchantLastBranchRequired,
  merchantStatusRestricted,
} from '../domain/merchant.errors';
import { statusAllowsBranchMutation } from '../domain/merchant.policy';
import {
  MERCHANT_BRANCH_OPERATIONAL_STATUS_ACTIVE,
  MERCHANT_MEMBER_ROLE_OWNER,
  MERCHANT_STATUS_ACTIVE,
  MERCHANT_STATUS_PENDING_REVIEW,
  newPublicReference,
  parseMerchantStatus,
  type CreateBranchInput,
  type CreateMerchantInput,
  type MerchantBranchRecord,
  type MerchantDocumentSummary,
  type MerchantMemberRecord,
  type MerchantRecord,
  type UpdateBranchInput,
  type UpdateMerchantInput,
} from '../domain/merchant.types';

function orm(client: { orm: SpeedyGoDb['orm'] }) {
  return client.orm.public;
}

function parseCoordinate(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  return Number.NaN;
}

@Injectable()
export class MerchantRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async listMembershipsByAccountId(
    accountId: string,
  ): Promise<MerchantMemberRecord[]> {
    const rows = await orm(this.db())
      .MerchantMember.where({ accountId })
      .orderBy((member) => member.createdAt.asc())
      .all();
    return rows.map((row) => this.toMember(row));
  }

  async findMembership(
    accountId: string,
    merchantId: string,
  ): Promise<MerchantMemberRecord | null> {
    const row = await orm(this.db())
      .MerchantMember.where({ accountId, merchantId })
      .first();
    return row ? this.toMember(row) : null;
  }

  async findMerchant(id: string): Promise<MerchantRecord | null> {
    const row = await orm(this.db()).Merchant.where({ id }).first();
    return row ? this.toMerchant(row) : null;
  }

  async createMerchantWithOwner(
    accountId: string,
    input: CreateMerchantInput,
  ): Promise<{ merchant: MerchantRecord; member: MerchantMemberRecord }> {
    const db = this.db();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await db.transaction(async (tx) => {
          const now = pgNow();
          const merchant = await orm(tx).Merchant.create({
            id: createUuidV7(),
            publicReference: pgVarchar<64>(newPublicReference()),
            name: pgVarchar<255>(input.name),
            status: pgVarchar<64>(MERCHANT_STATUS_PENDING_REVIEW),
            verifiedAt: null,
            createdAt: now,
            updatedAt: now,
          });
          const member = await orm(tx).MerchantMember.create({
            id: createUuidV7(),
            merchantId: merchant.id,
            accountId,
            role: pgVarchar<64>(MERCHANT_MEMBER_ROLE_OWNER),
            createdAt: now,
          });
          return {
            merchant: this.toMerchant(merchant),
            member: this.toMember(member),
          };
        });
      } catch (error) {
        if (isPostgresUniqueViolation(error) && attempt < 2) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Unable to create merchant');
  }

  async updateMerchant(
    merchantId: string,
    input: UpdateMerchantInput,
  ): Promise<MerchantRecord | null> {
    const patch: {
      name?: ReturnType<typeof pgVarchar<255>>;
      updatedAt: ReturnType<typeof pgNow>;
    } = { updatedAt: pgNow() };
    if (input.name !== undefined) {
      patch.name = pgVarchar<255>(input.name);
    }
    await orm(this.db()).Merchant.where({ id: merchantId }).update(patch);
    return this.findMerchant(merchantId);
  }

  async findMerchantsByIds(ids: string[]): Promise<MerchantRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await orm(this.db())
      .Merchant.where((merchant) => merchant.id.in(ids))
      .all();
    return rows.map((row) => this.toMerchant(row));
  }

  async listBranchesByMerchantIds(
    merchantIds: string[],
  ): Promise<MerchantBranchRecord[]> {
    if (merchantIds.length === 0) {
      return [];
    }
    const rows = await orm(this.db())
      .MerchantBranch.where((branch) => branch.merchantId.in(merchantIds))
      .orderBy((branch) => branch.createdAt.asc())
      .all();
    return rows.map((row) => this.toBranch(row));
  }

  async listDocumentSummariesByMerchantIds(
    merchantIds: string[],
  ): Promise<MerchantDocumentSummary[]> {
    if (merchantIds.length === 0) {
      return [];
    }
    const rows = await orm(this.db())
      .MerchantDocument.where((document) => document.merchantId.in(merchantIds))
      .orderBy((document) => document.createdAt.asc())
      .all();
    return rows.map((row) => ({
      id: row.id,
      merchantId: row.merchantId,
      type: row.type,
      status: row.status,
      expiryDate: row.expiryDate,
    }));
  }

  async listBranches(merchantId: string): Promise<MerchantBranchRecord[]> {
    const rows = await orm(this.db())
      .MerchantBranch.where({ merchantId })
      .orderBy((branch) => branch.createdAt.asc())
      .all();
    return rows.map((row) => this.toBranch(row));
  }

  async findOwnedBranch(
    merchantId: string,
    branchId: string,
  ): Promise<MerchantBranchRecord | null> {
    const row = await orm(this.db())
      .MerchantBranch.where({ id: branchId, merchantId })
      .first();
    return row ? this.toBranch(row) : null;
  }

  async createBranch(
    merchantId: string,
    input: CreateBranchInput,
  ): Promise<MerchantBranchRecord> {
    const now = pgNow();
    const row = await orm(this.db()).MerchantBranch.create({
      id: createUuidV7(),
      merchantId,
      name: pgVarchar<255>(input.name),
      phone: pgVarchar<32>(input.phone),
      addressText: input.addressText,
      latitude: pgNumeric<9, 6>(input.latitude, 6),
      longitude: pgNumeric<9, 6>(input.longitude, 6),
      operationalStatus: pgVarchar<64>(
        MERCHANT_BRANCH_OPERATIONAL_STATUS_ACTIVE,
      ),
      createdAt: now,
      updatedAt: now,
    });
    return this.toBranch(row);
  }

  async updateBranch(
    merchantId: string,
    branchId: string,
    input: UpdateBranchInput,
  ): Promise<MerchantBranchRecord | null> {
    const existing = await this.findOwnedBranch(merchantId, branchId);
    if (!existing) {
      return null;
    }
    const patch: {
      name?: ReturnType<typeof pgVarchar<255>>;
      phone?: ReturnType<typeof pgVarchar<32>>;
      addressText?: string;
      latitude?: ReturnType<typeof pgNumeric<9, 6>>;
      longitude?: ReturnType<typeof pgNumeric<9, 6>>;
      updatedAt: ReturnType<typeof pgNow>;
    } = { updatedAt: pgNow() };
    if (input.name !== undefined) {
      patch.name = pgVarchar<255>(input.name);
    }
    if (input.phone !== undefined) {
      patch.phone = pgVarchar<32>(input.phone);
    }
    if (input.addressText !== undefined) {
      patch.addressText = input.addressText;
    }
    if (input.latitude !== undefined) {
      patch.latitude = pgNumeric<9, 6>(input.latitude, 6);
    }
    if (input.longitude !== undefined) {
      patch.longitude = pgNumeric<9, 6>(input.longitude, 6);
    }
    await orm(this.db())
      .MerchantBranch.where({ id: branchId, merchantId })
      .update(patch);
    return this.findOwnedBranch(merchantId, branchId);
  }

  async deleteBranch(merchantId: string, branchId: string): Promise<boolean> {
    return this.deleteBranchGuarded(merchantId, branchId);
  }

  /**
   * Serializes branch deletes per Merchant by updating the Merchant row
   * (PostgreSQL row lock) before counting remaining branches.
   */
  async deleteBranchGuarded(
    merchantId: string,
    branchId: string,
  ): Promise<boolean> {
    const db = this.db();
    return db.transaction(async (tx) => {
      await orm(tx)
        .Merchant.where({ id: merchantId })
        .update({ updatedAt: pgNow() });
      const locked = await orm(tx).Merchant.where({ id: merchantId }).first();
      if (!locked) {
        return false;
      }
      const owned = await orm(tx)
        .MerchantBranch.where({ id: branchId, merchantId })
        .first();
      if (!owned) {
        return false;
      }
      const remaining = await orm(tx)
        .MerchantBranch.where({ merchantId })
        .select('id')
        .all();
      const status = parseMerchantStatus(locked.status);
      if (!status || !statusAllowsBranchMutation(status)) {
        throw merchantStatusRestricted(
          'Branches cannot be changed in the current Merchant status',
        );
      }
      if (status === MERCHANT_STATUS_ACTIVE && remaining.length <= 1) {
        throw merchantLastBranchRequired();
      }
      try {
        await orm(tx)
          .MerchantBranch.where({ id: branchId, merchantId })
          .delete();
        return true;
      } catch (error) {
        if (isPostgresForeignKeyViolation(error)) {
          throw merchantBranchInvalid(
            'Branch cannot be deleted while other records reference it',
          );
        }
        throw error;
      }
    });
  }

  async listDocumentSummaries(
    merchantId: string,
  ): Promise<MerchantDocumentSummary[]> {
    const rows = await orm(this.db())
      .MerchantDocument.where({ merchantId })
      .orderBy((document) => document.createdAt.asc())
      .all();
    return rows.map((row) => ({
      id: row.id,
      merchantId: row.merchantId,
      type: row.type,
      status: row.status,
      expiryDate: row.expiryDate,
    }));
  }

  private toMerchant(row: {
    id: string;
    publicReference: string;
    name: string;
    status: string;
    verifiedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }): MerchantRecord {
    return {
      id: row.id,
      publicReference: row.publicReference,
      name: row.name,
      status: row.status,
      verifiedAt: row.verifiedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toMember(row: {
    id: string;
    merchantId: string;
    accountId: string;
    role: string;
    createdAt: string;
  }): MerchantMemberRecord {
    return {
      id: row.id,
      merchantId: row.merchantId,
      accountId: row.accountId,
      role: row.role,
      createdAt: row.createdAt,
    };
  }

  private toBranch(row: {
    id: string;
    merchantId: string;
    name: string;
    phone: string;
    addressText: string;
    latitude: unknown;
    longitude: unknown;
    operationalStatus: string;
    createdAt: string;
    updatedAt: string;
  }): MerchantBranchRecord {
    return {
      id: row.id,
      merchantId: row.merchantId,
      name: row.name,
      phone: row.phone,
      addressText: row.addressText,
      latitude: parseCoordinate(row.latitude),
      longitude: parseCoordinate(row.longitude),
      operationalStatus: row.operationalStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
