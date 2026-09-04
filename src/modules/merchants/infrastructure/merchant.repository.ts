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
  pgDate,
  pgNow,
  pgNumeric,
  pgVarchar,
  type PgTimestamptz,
} from '../../../infrastructure/database/pg-values';
import {
  merchantBranchInvalid,
  merchantLastBranchRequired,
  merchantStatusRestricted,
  merchantVerificationIntegrity,
} from '../domain/merchant.errors';
import { statusAllowsBranchMutation } from '../domain/merchant.policy';
import {
  MERCHANT_BRANCH_OPERATIONAL_STATUS_ACTIVE,
  MERCHANT_DOCUMENT_STATUS_PENDING,
  MERCHANT_DOCUMENT_STATUS_SUBMITTED,
  MERCHANT_MEMBER_ROLE_OWNER,
  MERCHANT_STATUS_ACTIVE,
  MERCHANT_STATUS_PENDING_REVIEW,
  newPublicReference,
  objectKeyForMerchantDocument,
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

export type OrmClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

function orm(client: OrmClient) {
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
    client?: OrmClient,
  ): Promise<MerchantDocumentSummary[]> {
    const rows = await orm(client ?? this.db())
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

  /**
   * Bounded document list for internal review packages (max 50).
   */
  async listDocumentSummariesBounded(
    merchantId: string,
    limit = 50,
    client?: OrmClient,
  ): Promise<MerchantDocumentSummary[]> {
    const rows = await orm(client ?? this.db())
      .MerchantDocument.where({ merchantId })
      .orderBy((document) => document.createdAt.asc())
      .all();
    return rows.slice(0, limit).map((row) => ({
      id: row.id,
      merchantId: row.merchantId,
      type: row.type,
      status: row.status,
      expiryDate: row.expiryDate,
    }));
  }

  runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction(async (tx: OrmClient) => fn(tx));
  }

  async lockMerchant(
    merchantId: string,
    client: OrmClient,
  ): Promise<MerchantRecord | null> {
    await orm(client)
      .Merchant.where({ id: merchantId })
      .update({ updatedAt: pgNow() });
    const row = await orm(client).Merchant.where({ id: merchantId }).first();
    return row ? this.toMerchant(row) : null;
  }

  async findMerchantInTx(
    merchantId: string,
    client: OrmClient,
  ): Promise<MerchantRecord | null> {
    const row = await orm(client).Merchant.where({ id: merchantId }).first();
    return row ? this.toMerchant(row) : null;
  }

  async adminExists(adminId: string, client?: OrmClient): Promise<boolean> {
    const row = await orm(client ?? this.db())
      .AdminProfile.where({ id: adminId })
      .first();
    return Boolean(row);
  }

  async setMerchantStatus(
    merchantId: string,
    status: string,
    verifiedAt: PgTimestamptz | null,
    client: OrmClient,
  ): Promise<MerchantRecord | null> {
    await orm(client)
      .Merchant.where({ id: merchantId })
      .update({
        status: pgVarchar<64>(status),
        verifiedAt,
        updatedAt: pgNow(),
      });
    return this.findMerchantInTx(merchantId, client);
  }

  /**
   * One authoritative row per (merchantId, type) via application upsert.
   * Fail closed if multiple same-type rows already exist.
   */
  async upsertDocument(
    merchantId: string,
    type: string,
    expiryDate: string | null,
    client: OrmClient,
  ): Promise<MerchantDocumentSummary> {
    const now = pgNow();
    const existing = await orm(client)
      .MerchantDocument.where({ merchantId })
      .all();
    const matches = existing.filter((row) => row.type === type);
    if (matches.length > 1) {
      throw merchantVerificationIntegrity(
        'Duplicate MerchantDocument type rows exist',
      );
    }
    const current = matches[0];
    if (current) {
      await orm(client)
        .MerchantDocument.where({ id: current.id })
        .update({
          expiryDate: expiryDate ? pgDate(expiryDate) : null,
          status: pgVarchar<64>(MERCHANT_DOCUMENT_STATUS_PENDING),
          updatedAt: now,
        });
      const row = await orm(client)
        .MerchantDocument.where({ id: current.id })
        .first();
      return {
        id: row!.id,
        merchantId: row!.merchantId,
        type: row!.type,
        status: row!.status,
        expiryDate: row!.expiryDate,
      };
    }
    const id = createUuidV7();
    const created = await orm(client).MerchantDocument.create({
      id,
      merchantId,
      type: pgVarchar<64>(type),
      fileUrl: objectKeyForMerchantDocument(id),
      status: pgVarchar<64>(MERCHANT_DOCUMENT_STATUS_PENDING),
      expiryDate: expiryDate ? pgDate(expiryDate) : null,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id: created.id,
      merchantId: created.merchantId,
      type: created.type,
      status: created.status,
      expiryDate: created.expiryDate,
    };
  }

  async markDocumentsSubmitted(
    merchantId: string,
    client: OrmClient,
  ): Promise<void> {
    const now = pgNow();
    const rows = await orm(client).MerchantDocument.where({ merchantId }).all();
    for (const row of rows) {
      if (row.status !== MERCHANT_DOCUMENT_STATUS_SUBMITTED) {
        await orm(client)
          .MerchantDocument.where({ id: row.id })
          .update({
            status: pgVarchar<64>(MERCHANT_DOCUMENT_STATUS_SUBMITTED),
            updatedAt: now,
          });
      }
    }
  }

  async resetDocumentsToPending(
    merchantId: string,
    client: OrmClient,
  ): Promise<void> {
    const now = pgNow();
    const rows = await orm(client).MerchantDocument.where({ merchantId }).all();
    for (const row of rows) {
      if (row.status !== MERCHANT_DOCUMENT_STATUS_PENDING) {
        await orm(client)
          .MerchantDocument.where({ id: row.id })
          .update({
            status: pgVarchar<64>(MERCHANT_DOCUMENT_STATUS_PENDING),
            updatedAt: now,
          });
      }
    }
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
