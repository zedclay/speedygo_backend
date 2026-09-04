import { Injectable } from '@nestjs/common';
import { ADMIN_PERMISSIONS } from '../../admin/domain/admin-permissions';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../../admin/domain/admin-audit-actions';
import type { CurrentAdminContext } from '../../admin/domain/admin.types';
import { AdminAuditService } from '../../admin/application/admin-audit.service';
import {
  supportInvalidInput,
  supportInvalidState,
  supportNotFound,
} from '../domain/support.errors';
import {
  canAdminClose,
  canAdminReopen,
  canAdminResolve,
  canAdminStart,
  canAdminWaitCustomer,
  isValidSupportBody,
  normalizeSupportListQuery,
  parseSupportPriority,
  parseSupportStatus,
  SUPPORT_STATUS_CLOSED,
  SUPPORT_STATUS_IN_PROGRESS,
  SUPPORT_STATUS_OPEN,
  SUPPORT_STATUS_RESOLVED,
  SUPPORT_STATUS_WAITING_CUSTOMER,
  type SupportStatus,
} from '../domain/support.policy';
import type {
  AdminSupportListFilters,
  SupportInternalNoteDto,
  SupportMessageDto,
  SupportPaginatedResult,
  SupportTicketDetailDto,
  SupportTicketListItemDto,
} from '../domain/support.types';
import {
  SUPPORT_ADMIN_DISPLAY_NAME,
  toAdminTicketDetail,
  toTicketListItem,
} from '../domain/support.types';
import { SupportRepository } from '../infrastructure/support.repository';

function assigneeHasSupportManage(permissions: string[]): boolean {
  return permissions.includes(ADMIN_PERMISSIONS.SUPPORT_MANAGE);
}

@Injectable()
export class SupportAdminService {
  constructor(
    private readonly support: SupportRepository,
    private readonly audit: AdminAuditService,
  ) {}

  private assertBody(body: string): string {
    if (!isValidSupportBody(body)) {
      throw supportInvalidInput(
        'Support message body must be 1–4000 characters',
      );
    }
    return body.trim();
  }

  private mapMessage(
    message: {
      id: string;
      ticketId: string;
      authorAccountId: string;
      body: string;
      createdAt: string;
    },
    isAdminAuthor: boolean,
  ): SupportMessageDto {
    return {
      id: message.id,
      ticketId: message.ticketId,
      authorAccountId: message.authorAccountId,
      body: message.body,
      createdAt: message.createdAt,
      displayName: isAdminAuthor ? SUPPORT_ADMIN_DISPLAY_NAME : null,
    };
  }

  async listTickets(query: {
    status?: string;
    priority?: string;
    assignedAdminId?: string;
    createdFrom?: string;
    createdTo?: string;
    limit?: number;
    offset?: number;
  }): Promise<SupportPaginatedResult<SupportTicketListItemDto>> {
    const { limit, offset } = normalizeSupportListQuery(query);
    const filters: AdminSupportListFilters = {};
    if (query.status) {
      const status = parseSupportStatus(query.status);
      if (!status) {
        throw supportInvalidInput('Invalid status filter');
      }
      filters.status = status;
    }
    if (query.priority) {
      const priority = parseSupportPriority(query.priority);
      if (!priority) {
        throw supportInvalidInput('Invalid priority filter');
      }
      filters.priority = priority;
    }
    if (query.assignedAdminId) {
      filters.assignedAdminId = query.assignedAdminId;
    }
    if (query.createdFrom) {
      filters.createdFrom = query.createdFrom;
    }
    if (query.createdTo) {
      filters.createdTo = query.createdTo;
    }
    const page = await this.support.listTicketsAdmin(filters, limit, offset);
    return {
      items: page.items.map(toTicketListItem),
      total: page.total,
      limit,
      offset,
    };
  }

  async getTicket(
    ticketId: string,
    messageQuery?: { limit?: number; offset?: number },
  ): Promise<SupportTicketDetailDto> {
    const ticket = await this.support.findTicket(ticketId);
    if (!ticket) {
      throw supportNotFound();
    }
    const { limit, offset } = normalizeSupportListQuery(messageQuery ?? {});
    const messagesPage = await this.support.listMessages(
      ticketId,
      limit,
      offset,
    );
    const notes = await this.support.listInternalNotes(ticketId);
    const order = ticket.orderId
      ? await this.support.findOrderSafeContext(ticket.orderId)
      : null;
    const messages: SupportMessageDto[] = [];
    for (const message of messagesPage.items) {
      const isAdmin = await this.support.isAdminAuthor(message.authorAccountId);
      messages.push(this.mapMessage(message, isAdmin));
    }
    const internalNotes: SupportInternalNoteDto[] = notes.map((note) => ({
      id: note.id,
      ticketId: note.ticketId,
      adminId: note.adminId,
      body: note.body,
      createdAt: note.createdAt,
    }));
    return toAdminTicketDetail(ticket, order, messages, internalNotes);
  }

  async reply(
    admin: CurrentAdminContext,
    ticketId: string,
    body: string,
  ): Promise<SupportMessageDto> {
    const trimmed = this.assertBody(body);
    return this.support.runInTransaction(async (tx) => {
      const locked = await this.support.lockTicket(ticketId, tx);
      if (!locked) {
        throw supportNotFound();
      }
      const message = await this.support.addMessage(
        ticketId,
        admin.accountId,
        trimmed,
        tx,
      );
      return this.mapMessage(message, true);
    });
  }

  async addInternalNote(
    admin: CurrentAdminContext,
    ticketId: string,
    body: string,
  ): Promise<SupportInternalNoteDto> {
    const trimmed = this.assertBody(body);
    return this.support.runInTransaction(async (tx) => {
      const locked = await this.support.lockTicket(ticketId, tx);
      if (!locked) {
        throw supportNotFound();
      }
      const note = await this.support.addInternalNote(
        ticketId,
        admin.adminProfileId,
        trimmed,
        tx,
      );
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.SUPPORT_INTERNAL_NOTE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.SUPPORT_TICKET,
        targetId: ticketId,
        afterJson: { noteId: note.id, bodyLength: note.body.length },
        sessionId: admin.sessionId,
      });
      return {
        id: note.id,
        ticketId: note.ticketId,
        adminId: note.adminId,
        body: note.body,
        createdAt: note.createdAt,
      };
    });
  }

  async assign(
    admin: CurrentAdminContext,
    ticketId: string,
    assignedAdminId: string | null,
  ): Promise<SupportTicketListItemDto> {
    return this.support.runInTransaction(async (tx) => {
      const locked = await this.support.lockTicket(ticketId, tx);
      if (!locked) {
        throw supportNotFound();
      }
      if (assignedAdminId !== null) {
        const assignee = await this.support.findAssignableAdmin(
          assignedAdminId,
          tx,
        );
        if (!assignee || !assigneeHasSupportManage(assignee.permissions)) {
          throw supportInvalidInput(
            'assignedAdminId must be an AdminProfile with active Role and support.manage',
          );
        }
      }
      const before = { assignedAdminId: locked.assignedAdminId };
      const updated = await this.support.updateTicketAssignment(
        ticketId,
        assignedAdminId,
        tx,
      );
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.SUPPORT_ASSIGN,
        targetType: ADMIN_AUDIT_TARGET_TYPES.SUPPORT_TICKET,
        targetId: ticketId,
        beforeJson: before,
        afterJson: { assignedAdminId: updated.assignedAdminId },
        sessionId: admin.sessionId,
      });
      return toTicketListItem(updated);
    });
  }

  async setPriority(
    admin: CurrentAdminContext,
    ticketId: string,
    priorityRaw: string,
  ): Promise<SupportTicketListItemDto> {
    const priority = parseSupportPriority(priorityRaw);
    if (!priority) {
      throw supportInvalidInput('priority must be LOW, NORMAL, or HIGH');
    }
    return this.transitionWithAudit(
      admin,
      ticketId,
      ADMIN_AUDIT_ACTIONS.SUPPORT_PRIORITY_CHANGE,
      async (locked, tx) => {
        const before = { priority: locked.priority };
        const updated = await this.support.updateTicketPriority(
          ticketId,
          priority,
          tx,
        );
        return {
          ticket: updated,
          beforeJson: before,
          afterJson: { priority: updated.priority },
        };
      },
    );
  }

  async start(
    admin: CurrentAdminContext,
    ticketId: string,
  ): Promise<SupportTicketListItemDto> {
    return this.transitionStatus(
      admin,
      ticketId,
      SUPPORT_STATUS_IN_PROGRESS,
      canAdminStart,
    );
  }

  async waitCustomer(
    admin: CurrentAdminContext,
    ticketId: string,
  ): Promise<SupportTicketListItemDto> {
    return this.transitionStatus(
      admin,
      ticketId,
      SUPPORT_STATUS_WAITING_CUSTOMER,
      canAdminWaitCustomer,
    );
  }

  async resolve(
    admin: CurrentAdminContext,
    ticketId: string,
  ): Promise<SupportTicketListItemDto> {
    return this.transitionStatus(
      admin,
      ticketId,
      SUPPORT_STATUS_RESOLVED,
      canAdminResolve,
    );
  }

  async close(
    admin: CurrentAdminContext,
    ticketId: string,
  ): Promise<SupportTicketListItemDto> {
    return this.transitionStatus(
      admin,
      ticketId,
      SUPPORT_STATUS_CLOSED,
      canAdminClose,
    );
  }

  async reopen(
    admin: CurrentAdminContext,
    ticketId: string,
  ): Promise<SupportTicketListItemDto> {
    return this.transitionStatus(
      admin,
      ticketId,
      SUPPORT_STATUS_OPEN,
      canAdminReopen,
    );
  }

  private async transitionStatus(
    admin: CurrentAdminContext,
    ticketId: string,
    next: SupportStatus,
    allowed: (status: SupportStatus) => boolean,
  ): Promise<SupportTicketListItemDto> {
    return this.transitionWithAudit(
      admin,
      ticketId,
      ADMIN_AUDIT_ACTIONS.SUPPORT_STATUS_CHANGE,
      async (locked, tx) => {
        if (!allowed(locked.status)) {
          throw supportInvalidState(
            `Cannot transition Support ticket from ${locked.status} to ${next}`,
          );
        }
        const before = { status: locked.status };
        const updated = await this.support.updateTicketStatus(
          ticketId,
          next,
          tx,
        );
        return {
          ticket: updated,
          beforeJson: before,
          afterJson: { status: updated.status },
        };
      },
    );
  }

  private async transitionWithAudit(
    admin: CurrentAdminContext,
    ticketId: string,
    action: string,
    mutate: (
      locked: NonNullable<Awaited<ReturnType<SupportRepository['lockTicket']>>>,
      tx: {
        orm: import('../../../infrastructure/database/database.module').SpeedyGoDb['orm'];
      },
    ) => Promise<{
      ticket: NonNullable<Awaited<ReturnType<SupportRepository['findTicket']>>>;
      beforeJson: unknown;
      afterJson: unknown;
    }>,
  ): Promise<SupportTicketListItemDto> {
    return this.support.runInTransaction(async (tx) => {
      const locked = await this.support.lockTicket(ticketId, tx);
      if (!locked) {
        throw supportNotFound();
      }
      const result = await mutate(locked, tx);
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action,
        targetType: ADMIN_AUDIT_TARGET_TYPES.SUPPORT_TICKET,
        targetId: ticketId,
        beforeJson: result.beforeJson,
        afterJson: result.afterJson,
        sessionId: admin.sessionId,
      });
      return toTicketListItem(result.ticket);
    });
  }
}

/** Exported for unit tests — internal note must never appear on user DTOs. */
export function userDetailOmitsInternalNotes(
  detail: SupportTicketDetailDto,
): boolean {
  return detail.internalNotes === undefined;
}
