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
  LEGAL_KINDS,
  LEGAL_SEED_VERSION,
  MERCHANT_BRANCH_OPERATIONAL_STATUS_ACTIVE,
  MERCHANT_DOCUMENT_STATUS_PENDING,
  MERCHANT_DOCUMENT_STATUS_SUBMITTED,
  MERCHANT_MEMBER_ROLE_OWNER,
  MERCHANT_STATUS_ACTIVE,
  MERCHANT_STATUS_PENDING_REVIEW,
  VERIFICATION_ISSUE_SCOPE_DOCUMENT,
  VERIFICATION_OUTCOME_PENDING_REVIEW,
  VERIFICATION_OUTCOME_REJECTED,
  newPublicReference,
  objectKeyForMerchantDocument,
  parseMerchantStatus,
  pickCurrentLegalVersions,
  type CreateBranchInput,
  type CreateMerchantInput,
  type LegalAcceptanceRecord,
  type LegalDocumentVersionRecord,
  type MerchantBranchClassificationView,
  type MerchantBranchRecord,
  type MerchantDocumentSummary,
  type MerchantMemberRecord,
  type MerchantRecord,
  type MerchantVerificationRecords,
  type UpdateBranchInput,
  type UpdateMerchantInput,
  type ValidatedRejectionIssue,
  type VerificationIssueRecord,
  type VerificationSubmissionRecord,
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

  /** Distinct Account ids with a MerchantMember row for this Merchant. */
  async listMemberAccountIds(
    merchantId: string,
    client: OrmClient = this.db(),
  ): Promise<string[]> {
    const rows = await orm(client)
      .MerchantMember.where({ merchantId })
      .select('accountId')
      .all();
    return [...new Set(rows.map((row) => row.accountId))];
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

  async listBranchClassifications(
    branchIds: string[],
  ): Promise<Map<string, MerchantBranchClassificationView>> {
    const result = new Map<string, MerchantBranchClassificationView>();
    if (branchIds.length === 0) {
      return result;
    }
    const assignments = await orm(this.db())
      .MerchantBranchClassification.where((row) => row.branchId.in(branchIds))
      .all();
    if (assignments.length === 0) {
      return result;
    }
    const verticalIds = [...new Set(assignments.map((row) => row.verticalId))];
    const verticals = await orm(this.db())
      .CommerceVertical.where((row) => row.id.in(verticalIds))
      .all();
    const byId = new Map(verticals.map((row) => [row.id, row]));
    for (const assignment of assignments) {
      const vertical = byId.get(assignment.verticalId);
      if (!vertical) {
        continue;
      }
      result.set(assignment.branchId, {
        verticalId: vertical.id,
        slug: String(vertical.slug),
        name: String(vertical.name),
        iconKey: String(vertical.iconKey),
      });
    }
    return result;
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

  async findBranchById(
    branchId: string,
    client?: OrmClient,
  ): Promise<MerchantBranchRecord | null> {
    const row = await orm(client ?? this.db())
      .MerchantBranch.where({ id: branchId })
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
      wilayaCode: pgVarchar<2>(input.wilayaCode),
      communeId: input.communeId,
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
      wilayaCode?: ReturnType<typeof pgVarchar<2>>;
      communeId?: number;
      description?: string | null;
      nameAr?: ReturnType<typeof pgVarchar<255>> | null;
      publicEmail?: ReturnType<typeof pgVarchar<255>> | null;
      updatedAt: ReturnType<typeof pgNow>;
    } = { updatedAt: pgNow() };
    if (input.name !== undefined) {
      patch.name = pgVarchar<255>(input.name);
    }
    if (input.description !== undefined) {
      patch.description = input.description;
    }
    if (input.nameAr !== undefined) {
      patch.nameAr =
        input.nameAr === null ? null : pgVarchar<255>(input.nameAr);
    }
    if (input.publicEmail !== undefined) {
      patch.publicEmail =
        input.publicEmail === null ? null : pgVarchar<255>(input.publicEmail);
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
    if (input.wilayaCode !== undefined) {
      patch.wilayaCode = pgVarchar<2>(input.wilayaCode);
    }
    if (input.communeId !== undefined) {
      patch.communeId = input.communeId;
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

  async findDocumentById(documentId: string): Promise<{
    id: string;
    merchantId: string;
    type: string;
    status: string;
    expiryDate: string | null;
    fileUrl: string;
  } | null> {
    const row = await orm(this.db())
      .MerchantDocument.where({ id: documentId })
      .first();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      merchantId: row.merchantId,
      type: row.type,
      status: row.status,
      expiryDate: row.expiryDate,
      fileUrl: row.fileUrl,
    };
  }

  async updateDocumentFileUrl(
    documentId: string,
    fileUrl: string,
  ): Promise<void> {
    await orm(this.db()).MerchantDocument.where({ id: documentId }).update({
      fileUrl,
      updatedAt: pgNow(),
    });
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

  async listActiveLegalVersions(
    client?: OrmClient,
  ): Promise<LegalDocumentVersionRecord[]> {
    const rows = await orm(client ?? this.db())
      .LegalDocumentVersion.where({ active: true })
      .all();
    return pickCurrentLegalVersions(
      rows.map((row) => this.toLegalVersion(row)),
    );
  }

  /**
   * Returns the active version per kind, seeding the default row for any kind
   * that has none. Must run outside a caller transaction: a lost unique-race
   * on (kind, version) aborts a PostgreSQL transaction.
   */
  async ensureActiveLegalVersions(): Promise<LegalDocumentVersionRecord[]> {
    const active = await this.listActiveLegalVersions();
    const missing = LEGAL_KINDS.filter(
      (kind) => !active.some((row) => row.kind === kind),
    );
    if (missing.length === 0) {
      return active;
    }
    for (const kind of missing) {
      const now = pgNow();
      try {
        await orm(this.db()).LegalDocumentVersion.create({
          id: createUuidV7(),
          kind: pgVarchar<64>(kind),
          version: pgVarchar<32>(LEGAL_SEED_VERSION),
          contentUrl: null,
          contentSha256: null,
          effectiveFrom: now,
          active: true,
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        if (!isPostgresUniqueViolation(error)) {
          throw error;
        }
      }
    }
    return this.listActiveLegalVersions();
  }

  async findLatestSubmission(
    merchantId: string,
    client: OrmClient,
    outcome?: string,
  ): Promise<VerificationSubmissionRecord | null> {
    let query = orm(client).MerchantVerificationSubmission.where({
      merchantId,
    });
    if (outcome !== undefined) {
      query = query.where({ outcome: pgVarchar<64>(outcome) });
    }
    const row = await query.orderBy((s) => s.attemptNumber.desc()).first();
    return row ? this.toSubmission(row) : null;
  }

  async createVerificationSubmission(
    input: {
      merchantId: string;
      submittedByAccountId: string;
      outcome?: string;
      reviewedAt?: PgTimestamptz | null;
      reviewedByAdminId?: string | null;
    },
    client: OrmClient,
  ): Promise<VerificationSubmissionRecord> {
    const previous = await this.findLatestSubmission(input.merchantId, client);
    const now = pgNow();
    const row = await orm(client).MerchantVerificationSubmission.create({
      id: createUuidV7(),
      merchantId: input.merchantId,
      attemptNumber: (previous?.attemptNumber ?? 0) + 1,
      submittedAt: now,
      submittedByAccountId: input.submittedByAccountId,
      outcome: pgVarchar<64>(
        input.outcome ?? VERIFICATION_OUTCOME_PENDING_REVIEW,
      ),
      reviewedAt: input.reviewedAt ?? null,
      reviewedByAdminId: input.reviewedByAdminId ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return this.toSubmission(row);
  }

  async createLegalAcceptances(
    input: {
      merchantId: string;
      submissionId: string;
      accountId: string;
      memberRole: string;
      acceptances: Array<{ kind: string; version: string }>;
    },
    client: OrmClient,
  ): Promise<void> {
    const acceptedAt = pgNow();
    for (const acceptance of input.acceptances) {
      await orm(client).MerchantLegalAcceptance.create({
        id: createUuidV7(),
        merchantId: input.merchantId,
        submissionId: input.submissionId,
        accountId: input.accountId,
        memberRole: pgVarchar<64>(input.memberRole),
        kind: pgVarchar<64>(acceptance.kind),
        version: pgVarchar<32>(acceptance.version),
        acceptedAt,
        createdAt: acceptedAt,
      });
    }
  }

  async markSubmissionReviewed(
    submissionId: string,
    outcome: string,
    adminId: string,
    client: OrmClient,
  ): Promise<void> {
    const now = pgNow();
    await orm(client)
      .MerchantVerificationSubmission.where({ id: submissionId })
      .update({
        outcome: pgVarchar<64>(outcome),
        reviewedAt: now,
        reviewedByAdminId: adminId,
        updatedAt: now,
      });
  }

  /** Oldest OWNER Account; used to attribute legacy submissions. */
  async findOwnerAccountId(
    merchantId: string,
    client: OrmClient,
  ): Promise<string | null> {
    const row = await orm(client)
      .MerchantMember.where({
        merchantId,
        role: pgVarchar<64>(MERCHANT_MEMBER_ROLE_OWNER),
      })
      .orderBy((member) => member.createdAt.asc())
      .first();
    return row?.accountId ?? null;
  }

  async createRejectionIssues(
    input: {
      submissionId: string;
      merchantId: string;
      issues: ValidatedRejectionIssue[];
      documents: MerchantDocumentSummary[];
    },
    client: OrmClient,
  ): Promise<void> {
    const now = pgNow();
    for (const issue of input.issues) {
      const document =
        issue.scope === VERIFICATION_ISSUE_SCOPE_DOCUMENT
          ? input.documents.find((row) => row.type === issue.documentType)
          : undefined;
      await orm(client).MerchantVerificationIssue.create({
        id: createUuidV7(),
        submissionId: input.submissionId,
        merchantId: input.merchantId,
        scope: pgVarchar<64>(issue.scope),
        documentType: issue.documentType
          ? pgVarchar<64>(issue.documentType)
          : null,
        documentId: document?.id ?? null,
        code: pgVarchar<64>(issue.code),
        messageFr: pgVarchar<500>(issue.messageFr),
        resolvedAt: null,
        createdAt: now,
      });
    }
  }

  /**
   * DOCUMENT-scoped unresolved issues of `documentType` on the latest
   * REJECTED submission.
   */
  async resolveDocumentIssuesForType(
    merchantId: string,
    documentType: string,
    client: OrmClient,
  ): Promise<void> {
    const rejected = await this.findLatestSubmission(
      merchantId,
      client,
      VERIFICATION_OUTCOME_REJECTED,
    );
    if (!rejected) {
      return;
    }
    await orm(client)
      .MerchantVerificationIssue.where({
        submissionId: rejected.id,
        scope: pgVarchar<64>(VERIFICATION_ISSUE_SCOPE_DOCUMENT),
        documentType: pgVarchar<64>(documentType),
      })
      .where((issue) => issue.resolvedAt.isNull())
      .updateAll({ resolvedAt: pgNow() });
  }

  async resolveAllIssues(merchantId: string, client: OrmClient): Promise<void> {
    await orm(client)
      .MerchantVerificationIssue.where({ merchantId })
      .where((issue) => issue.resolvedAt.isNull())
      .updateAll({ resolvedAt: pgNow() });
  }

  /**
   * Raw submission / acceptance / unresolved-issue rows for the given
   * Merchants. Read models are assembled by `buildVerificationReviewView`.
   */
  async loadVerificationRecords(
    merchantIds: string[],
    client?: OrmClient,
  ): Promise<Map<string, MerchantVerificationRecords>> {
    const result = new Map<string, MerchantVerificationRecords>();
    if (merchantIds.length === 0) {
      return result;
    }
    const db = orm(client ?? this.db());
    const [submissions, acceptances, issues] = await Promise.all([
      db.MerchantVerificationSubmission.where((s) =>
        s.merchantId.in(merchantIds),
      ).all(),
      db.MerchantLegalAcceptance.where((a) =>
        a.merchantId.in(merchantIds),
      ).all(),
      db.MerchantVerificationIssue.where((i) => i.merchantId.in(merchantIds))
        .where((i) => i.resolvedAt.isNull())
        .all(),
    ]);
    const bucket = (merchantId: string): MerchantVerificationRecords => {
      let entry = result.get(merchantId);
      if (!entry) {
        entry = { submissions: [], acceptances: [], unresolvedIssues: [] };
        result.set(merchantId, entry);
      }
      return entry;
    };
    for (const row of submissions) {
      bucket(row.merchantId).submissions.push(this.toSubmission(row));
    }
    for (const row of acceptances) {
      bucket(row.merchantId).acceptances.push(this.toAcceptance(row));
    }
    for (const row of issues) {
      bucket(row.merchantId).unresolvedIssues.push(this.toIssue(row));
    }
    return result;
  }

  private toLegalVersion(row: {
    id: string;
    kind: string;
    version: string;
    contentUrl: string | null;
    contentSha256: string | null;
    effectiveFrom: string;
    active: boolean;
  }): LegalDocumentVersionRecord {
    return {
      id: row.id,
      kind: row.kind,
      version: row.version,
      contentUrl: row.contentUrl,
      contentSha256: row.contentSha256,
      effectiveFrom: row.effectiveFrom,
      active: row.active,
    };
  }

  private toSubmission(row: {
    id: string;
    merchantId: string;
    attemptNumber: number;
    submittedAt: string;
    submittedByAccountId: string;
    outcome: string;
    reviewedAt: string | null;
    reviewedByAdminId: string | null;
  }): VerificationSubmissionRecord {
    return {
      id: row.id,
      merchantId: row.merchantId,
      attemptNumber: row.attemptNumber,
      submittedAt: row.submittedAt,
      submittedByAccountId: row.submittedByAccountId,
      outcome: row.outcome,
      reviewedAt: row.reviewedAt,
      reviewedByAdminId: row.reviewedByAdminId,
    };
  }

  private toAcceptance(row: {
    id: string;
    merchantId: string;
    submissionId: string;
    kind: string;
    version: string;
    acceptedAt: string;
  }): LegalAcceptanceRecord {
    return {
      id: row.id,
      merchantId: row.merchantId,
      submissionId: row.submissionId,
      kind: row.kind,
      version: row.version,
      acceptedAt: row.acceptedAt,
    };
  }

  private toIssue(row: {
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
  }): VerificationIssueRecord {
    return {
      id: row.id,
      submissionId: row.submissionId,
      merchantId: row.merchantId,
      scope: row.scope,
      documentType: row.documentType,
      documentId: row.documentId,
      code: row.code,
      messageFr: row.messageFr,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
    };
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
    wilayaCode: string | null;
    communeId: number | null;
    operationalStatus: string;
    description: string | null;
    nameAr: string | null;
    publicEmail: string | null;
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
      wilayaCode: row.wilayaCode ?? null,
      communeId: row.communeId ?? null,
      operationalStatus: row.operationalStatus,
      description: row.description ?? null,
      nameAr: row.nameAr ?? null,
      publicEmail: row.publicEmail ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
