import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import { adminNotFound } from '../domain/admin.errors';
import {
  normalizeCustomerNoteBody,
  parseCustomerNoteCategory,
} from '../domain/customer-internal-notes.policy';
import { normalizeListQuery } from '../domain/admin.policy';
import type {
  AdminCustomerInternalNoteItem,
  AdminPaginatedResult,
  CurrentAdminContext,
} from '../domain/admin.types';
import { AdminAuditService } from './admin-audit.service';

type OrmClient = { orm: SpeedyGoDb['orm'] };

function orm(client: OrmClient) {
  return client.orm.public;
}

@Injectable()
export class AdminCustomerNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async listNotes(
    customerId: string,
    input: { limit?: number; offset?: number },
  ): Promise<AdminPaginatedResult<AdminCustomerInternalNoteItem>> {
    const customer = await orm(this.prisma.getDb())
      .CustomerProfile.where({ id: customerId })
      .first();
    if (!customer) {
      throw adminNotFound('Customer not found');
    }
    const query = normalizeListQuery(input);
    const where = { customerId };
    const counted = await orm(this.prisma.getDb())
      .CustomerInternalNote.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.prisma.getDb())
      .CustomerInternalNote.where(where)
      .orderBy([
        (row) => row.createdAt.desc(),
        (row) => row.id.desc(),
      ])
      .offset(query.offset)
      .limit(query.limit)
      .all();
    const adminIds = [...new Set(rows.map((r) => r.adminId))];
    const nameByAdmin = new Map<string, string>();
    for (const adminId of adminIds) {
      const profile = await orm(this.prisma.getDb())
        .AdminProfile.where({ id: adminId })
        .first();
      if (profile) nameByAdmin.set(adminId, profile.displayName);
    }
    return {
      items: rows.map((row) => ({
        id: row.id,
        customerId: row.customerId,
        adminId: row.adminId,
        authorDisplayName: nameByAdmin.get(row.adminId) ?? '—',
        category: row.category,
        body: row.body,
        createdAt: row.createdAt,
      })),
      total: Number(counted.total),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async createNote(
    admin: CurrentAdminContext,
    customerId: string,
    input: { category: string; body: string },
  ): Promise<AdminCustomerInternalNoteItem> {
    const category = parseCustomerNoteCategory(input.category);
    const body = normalizeCustomerNoteBody(input.body);

    return this.prisma.getDb().transaction(async (tx) => {
      const customer = await orm(tx)
        .CustomerProfile.where({ id: customerId })
        .first();
      if (!customer) {
        throw adminNotFound('Customer not found');
      }

      const noteId = createUuidV7();
      const now = pgNow();
      await orm(tx).CustomerInternalNote.create({
        id: noteId,
        customerId,
        adminId: admin.adminProfileId,
        category: pgVarchar<32>(category),
        body,
        createdAt: now,
      });

      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.CUSTOMER_INTERNAL_NOTE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.CUSTOMER,
        targetId: customerId,
        afterJson: {
          noteId,
          category,
          bodyLength: body.length,
        },
        sessionId: admin.sessionId,
      });

      const row = await orm(tx)
        .CustomerInternalNote.where({ id: noteId })
        .first();
      if (!row) {
        throw new Error('CustomerInternalNote create failed');
      }

      return {
        id: row.id,
        customerId: row.customerId,
        adminId: row.adminId,
        authorDisplayName: admin.displayName,
        category: row.category,
        body: row.body,
        createdAt: row.createdAt,
      };
    });
  }
}
