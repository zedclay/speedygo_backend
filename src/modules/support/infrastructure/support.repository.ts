import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import {
  parseSupportPriority,
  parseSupportStatus,
  type SupportPriority,
  type SupportStatus,
} from '../domain/support.policy';
import { supportIntegrity } from '../domain/support.errors';
import type {
  AdminSupportListFilters,
  CreateSupportTicketInput,
  SupportInternalNoteRecord,
  SupportMessageRecord,
  SupportOrderContext,
  SupportTicketRecord,
} from '../domain/support.types';
import {
  initialTicketPriority,
  initialTicketStatus,
  newSupportPublicReference,
} from '../domain/support.types';

export type OrmClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

function orm(client: OrmClient) {
  return client.orm.public;
}

function toTicket(row: {
  id: string;
  publicReference: string;
  createdByAccountId: string;
  orderId: string | null;
  merchantId: string | null;
  driverId: string | null;
  status: string;
  priority: string;
  assignedAdminId: string | null;
  createdAt: string;
  updatedAt: string;
}): SupportTicketRecord {
  const status = parseSupportStatus(row.status);
  const priority = parseSupportPriority(row.priority);
  if (!status || !priority) {
    throw supportIntegrity(
      `SupportTicket ${row.id} has unknown status/priority outside frozen vocabulary`,
    );
  }
  return {
    id: row.id,
    publicReference: row.publicReference,
    createdByAccountId: row.createdByAccountId,
    orderId: row.orderId,
    merchantId: row.merchantId,
    driverId: row.driverId,
    status,
    priority,
    assignedAdminId: row.assignedAdminId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMessage(row: {
  id: string;
  ticketId: string;
  authorAccountId: string;
  body: string;
  createdAt: string;
}): SupportMessageRecord {
  return {
    id: row.id,
    ticketId: row.ticketId,
    authorAccountId: row.authorAccountId,
    body: row.body,
    createdAt: row.createdAt,
  };
}

function toNote(row: {
  id: string;
  ticketId: string;
  adminId: string;
  body: string;
  createdAt: string;
}): SupportInternalNoteRecord {
  return {
    id: row.id,
    ticketId: row.ticketId,
    adminId: row.adminId,
    body: row.body,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class SupportRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction(async (tx) => fn(tx));
  }

  /**
   * Prisma 8 has no forUpdate helper; row UPDATE is the concurrent lock pattern.
   */
  async lockTicket(
    ticketId: string,
    client: OrmClient,
  ): Promise<SupportTicketRecord | null> {
    await orm(client)
      .SupportTicket.where({ id: ticketId })
      .update({ updatedAt: pgNow() });
    const row = await orm(client).SupportTicket.where({ id: ticketId }).first();
    return row ? toTicket(row) : null;
  }

  async findTicket(ticketId: string): Promise<SupportTicketRecord | null> {
    const row = await orm(this.db())
      .SupportTicket.where({ id: ticketId })
      .first();
    return row ? toTicket(row) : null;
  }

  async findTicketInTx(
    ticketId: string,
    client: OrmClient,
  ): Promise<SupportTicketRecord | null> {
    const row = await orm(client).SupportTicket.where({ id: ticketId }).first();
    return row ? toTicket(row) : null;
  }

  async findCustomerProfileByAccountId(
    accountId: string,
  ): Promise<{ id: string; accountId: string } | null> {
    const row = await orm(this.db())
      .CustomerProfile.where({ accountId })
      .first();
    return row ? { id: row.id, accountId: row.accountId } : null;
  }

  async findDriverProfileByAccountId(
    accountId: string,
  ): Promise<{ id: string; accountId: string } | null> {
    const row = await orm(this.db()).DriverProfile.where({ accountId }).first();
    return row ? { id: row.id, accountId: row.accountId } : null;
  }

  async findOrderSafeContext(
    orderId: string,
  ): Promise<SupportOrderContext | null> {
    const row = await orm(this.db()).Order.where({ id: orderId }).first();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      publicReference: row.publicReference,
      status: row.status,
    };
  }

  async orderBelongsToCustomer(
    orderId: string,
    customerProfileId: string,
  ): Promise<boolean> {
    const row = await orm(this.db()).Order.where({ id: orderId }).first();
    return Boolean(row && row.customerId === customerProfileId);
  }

  async orderBelongsToMerchant(
    orderId: string,
    merchantId: string,
  ): Promise<boolean> {
    const order = await orm(this.db()).Order.where({ id: orderId }).first();
    if (!order) {
      return false;
    }
    const branch = await orm(this.db())
      .MerchantBranch.where({ id: order.merchantBranchId })
      .first();
    return Boolean(branch && branch.merchantId === merchantId);
  }

  /**
   * Driver may link an Order when a Delivery exists and any DriverAssignment
   * for that Delivery matches the Driver (historical or current).
   */
  async orderAssignedToDriver(
    orderId: string,
    driverId: string,
  ): Promise<boolean> {
    const order = await orm(this.db()).Order.where({ id: orderId }).first();
    if (!order) {
      return false;
    }
    const delivery = await orm(this.db()).Delivery.where({ orderId }).first();
    if (!delivery) {
      return false;
    }
    const assignments = await orm(this.db())
      .DriverAssignment.where({ deliveryId: delivery.id, driverId })
      .limit(1)
      .all();
    return assignments.length > 0;
  }

  async createTicketWithFirstMessage(
    input: CreateSupportTicketInput,
    client: OrmClient,
  ): Promise<{ ticket: SupportTicketRecord; message: SupportMessageRecord }> {
    const now = pgNow();
    const ticketId = createUuidV7();
    const messageId = createUuidV7();
    const status = initialTicketStatus();
    const priority = initialTicketPriority();

    await orm(client).SupportTicket.create({
      id: ticketId,
      publicReference: pgVarchar<64>(newSupportPublicReference()),
      createdByAccountId: input.createdByAccountId,
      orderId: input.orderId ?? null,
      merchantId: input.merchantId ?? null,
      driverId: input.driverId ?? null,
      status: pgVarchar<64>(status),
      priority: pgVarchar<32>(priority),
      assignedAdminId: null,
      createdAt: now,
      updatedAt: now,
    });

    await orm(client).SupportMessage.create({
      id: messageId,
      ticketId,
      authorAccountId: input.createdByAccountId,
      body: input.body.trim(),
      createdAt: now,
    });

    const ticket = await orm(client)
      .SupportTicket.where({ id: ticketId })
      .first();
    const message = await orm(client)
      .SupportMessage.where({ id: messageId })
      .first();
    if (!ticket || !message) {
      throw new Error('SupportTicket create failed');
    }
    return { ticket: toTicket(ticket), message: toMessage(message) };
  }

  async addMessage(
    ticketId: string,
    authorAccountId: string,
    body: string,
    client: OrmClient,
    opts?: { nextStatus?: SupportStatus },
  ): Promise<SupportMessageRecord> {
    const now = pgNow();
    const messageId = createUuidV7();
    await orm(client).SupportMessage.create({
      id: messageId,
      ticketId,
      authorAccountId,
      body: body.trim(),
      createdAt: now,
    });
    const update: {
      updatedAt: ReturnType<typeof pgNow>;
      status?: ReturnType<typeof pgVarchar<64>>;
    } = { updatedAt: now };
    if (opts?.nextStatus) {
      update.status = pgVarchar<64>(opts.nextStatus);
    }
    await orm(client).SupportTicket.where({ id: ticketId }).update(update);
    const row = await orm(client)
      .SupportMessage.where({ id: messageId })
      .first();
    if (!row) {
      throw new Error('SupportMessage create failed');
    }
    return toMessage(row);
  }

  async addInternalNote(
    ticketId: string,
    adminId: string,
    body: string,
    client: OrmClient,
  ): Promise<SupportInternalNoteRecord> {
    const now = pgNow();
    const noteId = createUuidV7();
    await orm(client).SupportInternalNote.create({
      id: noteId,
      ticketId,
      adminId,
      body: body.trim(),
      createdAt: now,
    });
    await orm(client)
      .SupportTicket.where({ id: ticketId })
      .update({ updatedAt: now });
    const row = await orm(client)
      .SupportInternalNote.where({ id: noteId })
      .first();
    if (!row) {
      throw new Error('SupportInternalNote create failed');
    }
    return toNote(row);
  }

  async updateTicketStatus(
    ticketId: string,
    status: SupportStatus,
    client: OrmClient,
  ): Promise<SupportTicketRecord> {
    const now = pgNow();
    await orm(client)
      .SupportTicket.where({ id: ticketId })
      .update({
        status: pgVarchar<64>(status),
        updatedAt: now,
      });
    const row = await orm(client).SupportTicket.where({ id: ticketId }).first();
    if (!row) {
      throw new Error('SupportTicket status update failed');
    }
    return toTicket(row);
  }

  async updateTicketPriority(
    ticketId: string,
    priority: SupportPriority,
    client: OrmClient,
  ): Promise<SupportTicketRecord> {
    const now = pgNow();
    await orm(client)
      .SupportTicket.where({ id: ticketId })
      .update({
        priority: pgVarchar<32>(priority),
        updatedAt: now,
      });
    const row = await orm(client).SupportTicket.where({ id: ticketId }).first();
    if (!row) {
      throw new Error('SupportTicket priority update failed');
    }
    return toTicket(row);
  }

  async updateTicketAssignment(
    ticketId: string,
    assignedAdminId: string | null,
    client: OrmClient,
  ): Promise<SupportTicketRecord> {
    const now = pgNow();
    await orm(client).SupportTicket.where({ id: ticketId }).update({
      assignedAdminId,
      updatedAt: now,
    });
    const row = await orm(client).SupportTicket.where({ id: ticketId }).first();
    if (!row) {
      throw new Error('SupportTicket assignment update failed');
    }
    return toTicket(row);
  }

  async listTicketsForCreator(
    createdByAccountId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: SupportTicketRecord[]; total: number }> {
    const where = { createdByAccountId };
    const counted = await orm(this.db())
      .SupportTicket.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .SupportTicket.where(where)
      .orderBy((row) => row.updatedAt.desc())
      .offset(offset)
      .limit(limit)
      .all();
    return {
      items: rows.map(toTicket),
      total: Number(counted.total),
    };
  }

  async listTicketsForDriver(
    accountId: string,
    driverId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: SupportTicketRecord[]; total: number }> {
    // Creator OR ticket.driverId === own profile — scan bounded then filter.
    // Prefer exact OR when Prisma supports it; fallback: two queries merged.
    const byCreator = await orm(this.db())
      .SupportTicket.where({ createdByAccountId: accountId })
      .orderBy((row) => row.updatedAt.desc())
      .limit(Math.min(500, offset + limit + 50))
      .all();
    const byDriver = await orm(this.db())
      .SupportTicket.where({ driverId })
      .orderBy((row) => row.updatedAt.desc())
      .limit(Math.min(500, offset + limit + 50))
      .all();
    const map = new Map<string, SupportTicketRecord>();
    for (const row of [...byCreator, ...byDriver].map(toTicket)) {
      map.set(row.id, row);
    }
    const merged = [...map.values()].sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) {
        return a.updatedAt < b.updatedAt ? 1 : -1;
      }
      return a.id < b.id ? 1 : -1;
    });
    return {
      items: merged.slice(offset, offset + limit),
      total: merged.length,
    };
  }

  async listTicketsForMerchant(
    merchantId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: SupportTicketRecord[]; total: number }> {
    const where = { merchantId };
    const counted = await orm(this.db())
      .SupportTicket.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .SupportTicket.where(where)
      .orderBy((row) => row.updatedAt.desc())
      .offset(offset)
      .limit(limit)
      .all();
    return {
      items: rows.map(toTicket),
      total: Number(counted.total),
    };
  }

  async listTicketsAdmin(
    filters: AdminSupportListFilters,
    limit: number,
    offset: number,
  ): Promise<{ items: SupportTicketRecord[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filters.status) {
      where.status = pgVarchar<64>(filters.status);
    }
    if (filters.priority) {
      where.priority = pgVarchar<32>(filters.priority);
    }
    if (filters.assignedAdminId) {
      where.assignedAdminId = filters.assignedAdminId;
    }

    const needsDateFilter = Boolean(filters.createdFrom || filters.createdTo);
    if (needsDateFilter) {
      const scanCap = Math.min(1_000, offset + limit + 200);
      const rows = await orm(this.db())
        .SupportTicket.where(where)
        .orderBy((row) => row.updatedAt.desc())
        .limit(scanCap)
        .all();
      let filtered = rows.map(toTicket);
      if (filters.createdFrom) {
        filtered = filtered.filter(
          (row) => row.createdAt >= filters.createdFrom!,
        );
      }
      if (filters.createdTo) {
        filtered = filtered.filter((row) => row.createdAt < filters.createdTo!);
      }
      return {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
      };
    }

    const counted = await orm(this.db())
      .SupportTicket.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .SupportTicket.where(where)
      .orderBy((row) => row.updatedAt.desc())
      .offset(offset)
      .limit(limit)
      .all();
    return {
      items: rows.map(toTicket),
      total: Number(counted.total),
    };
  }

  async listMessages(
    ticketId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: SupportMessageRecord[]; total: number }> {
    const where = { ticketId };
    const counted = await orm(this.db())
      .SupportMessage.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .SupportMessage.where(where)
      .orderBy((row) => row.createdAt.asc())
      .offset(offset)
      .limit(limit)
      .all();
    return {
      items: rows.map(toMessage),
      total: Number(counted.total),
    };
  }

  async listInternalNotes(
    ticketId: string,
  ): Promise<SupportInternalNoteRecord[]> {
    const rows = await orm(this.db())
      .SupportInternalNote.where({ ticketId })
      .orderBy((row) => row.createdAt.asc())
      .all();
    return rows.map(toNote);
  }

  /**
   * Assignee must have AdminProfile, active Role, and support.manage.
   * Prefer calling inside the assignment transaction with `client`.
   */
  async findAssignableAdmin(
    adminProfileId: string,
    client?: OrmClient,
  ): Promise<{
    adminId: string;
    accountId: string;
    permissions: string[];
  } | null> {
    const db = client ? orm(client) : orm(this.db());
    const admin = await db.AdminProfile.where({ id: adminProfileId }).first();
    if (!admin) {
      return null;
    }
    const role = await db.Role.where({ id: admin.roleId }).first();
    if (!role || !role.active) {
      return null;
    }
    const links = await db.RolePermission.where({ roleId: role.id }).all();
    const permissions: string[] = [];
    for (const link of links) {
      const permission = await db.Permission.where({
        id: link.permissionId,
      }).first();
      if (permission) {
        permissions.push(String(permission.code));
      }
    }
    return {
      adminId: admin.id,
      accountId: admin.accountId,
      permissions,
    };
  }

  async isAdminAuthor(accountId: string): Promise<boolean> {
    const admin = await orm(this.db())
      .AdminProfile.where({ accountId })
      .first();
    return Boolean(admin);
  }
}
