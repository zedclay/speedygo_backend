import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import { adminAuditFailed } from '../domain/admin.errors';
import { normalizeListQuery } from '../domain/admin.policy';
import type {
  AdminAuditListItem,
  AdminAuditListQuery,
  AdminPaginatedResult,
} from '../domain/admin.types';

export type OrmClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

export type RecordAuditInput = {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  sessionId?: string | null;
  ipAddress?: string | null;
};

function orm(client: OrmClient) {
  return client.orm.public;
}

function toAudit(row: {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  beforeJson: unknown;
  afterJson: unknown;
  ipAddress: string | null;
  sessionId: string | null;
  createdAt: string;
}): AdminAuditListItem {
  return {
    id: row.id,
    adminId: row.adminId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    beforeJson: row.beforeJson,
    afterJson: row.afterJson,
    ipAddress: row.ipAddress,
    sessionId: row.sessionId,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async record(input: RecordAuditInput): Promise<AdminAuditListItem> {
    try {
      return await this.insert(this.db(), input);
    } catch (error) {
      throw adminAuditFailed(
        error instanceof Error ? error.message : 'AuditLog insert failed',
      );
    }
  }

  async recordInTx(
    client: OrmClient,
    input: RecordAuditInput,
  ): Promise<AdminAuditListItem> {
    try {
      return await this.insert(client, input);
    } catch (error) {
      throw adminAuditFailed(
        error instanceof Error ? error.message : 'AuditLog insert failed',
      );
    }
  }

  async listAudits(
    query: Partial<AdminAuditListQuery> & {
      limit?: number;
      offset?: number;
    },
  ): Promise<AdminPaginatedResult<AdminAuditListItem>> {
    const { limit, offset } = normalizeListQuery(query);
    const where: Record<string, unknown> = {};
    if (query.adminId) {
      where.adminId = query.adminId;
    }
    if (query.action) {
      where.action = pgVarchar<128>(query.action);
    }
    if (query.targetType) {
      where.targetType = pgVarchar<64>(query.targetType);
    }
    if (query.targetId) {
      where.targetId = query.targetId;
    }

    // Equality filters use DB count + page. Date-range filters are applied in
    // memory on a bounded newest window so AuditLog is never dumped unbounded.
    const needsDateFilter = Boolean(query.createdFrom || query.createdTo);
    if (needsDateFilter) {
      const scanCap = Math.min(1_000, offset + limit + 200);
      const rows = await orm(this.db())
        .AuditLog.where(where)
        .orderBy((row) => row.createdAt.desc())
        .limit(scanCap)
        .all();
      let filtered = rows.map(toAudit);
      if (query.createdFrom) {
        filtered = filtered.filter(
          (row) => row.createdAt >= query.createdFrom!,
        );
      }
      if (query.createdTo) {
        filtered = filtered.filter((row) => row.createdAt < query.createdTo!);
      }
      return {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
        limit,
        offset,
      };
    }

    const counted = await orm(this.db())
      .AuditLog.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .AuditLog.where(where)
      .orderBy((row) => row.createdAt.desc())
      .offset(offset)
      .limit(limit)
      .all();
    return {
      items: rows.map(toAudit),
      total: Number(counted.total),
      limit,
      offset,
    };
  }

  private async insert(
    client: OrmClient,
    input: RecordAuditInput,
  ): Promise<AdminAuditListItem> {
    const id = createUuidV7();
    await orm(client).AuditLog.create({
      id,
      adminId: input.adminId,
      action: pgVarchar<128>(input.action),
      targetType: pgVarchar<64>(input.targetType),
      targetId: input.targetId,
      beforeJson:
        input.beforeJson === undefined
          ? null
          : (JSON.parse(JSON.stringify(input.beforeJson)) as never),
      afterJson:
        input.afterJson === undefined
          ? null
          : (JSON.parse(JSON.stringify(input.afterJson)) as never),
      ipAddress: input.ipAddress ?? null,
      sessionId: input.sessionId ?? null,
      createdAt: pgNow(),
    });
    const row = await orm(client).AuditLog.where({ id }).first();
    if (!row) {
      throw new Error('AuditLog create failed');
    }
    return toAudit(row);
  }
}
