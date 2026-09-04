import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  SUPPORT_PRIORITY_NORMAL,
  SUPPORT_STATUS_OPEN,
  type SupportPriority,
  type SupportStatus,
} from './support.policy';

export const SUPPORT_ADMIN_DISPLAY_NAME = 'SpeedyGo Support';

export const SUPPORT_LIST_DEFAULT_LIMIT = 50;
export const SUPPORT_LIST_MAX_LIMIT = 100;
export const SUPPORT_LIST_MAX_OFFSET = 10_000;

export const SUPPORT_MESSAGE_BODY_MIN = 1;
export const SUPPORT_MESSAGE_BODY_MAX = 4000;

export type SupportTicketRecord = {
  id: string;
  publicReference: string;
  createdByAccountId: string;
  orderId: string | null;
  merchantId: string | null;
  driverId: string | null;
  status: SupportStatus;
  priority: SupportPriority;
  assignedAdminId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupportMessageRecord = {
  id: string;
  ticketId: string;
  authorAccountId: string;
  body: string;
  createdAt: string;
};

export type SupportInternalNoteRecord = {
  id: string;
  ticketId: string;
  adminId: string;
  body: string;
  createdAt: string;
};

export type SupportOrderContext = {
  id: string;
  publicReference: string;
  status: string;
};

export type SupportMessageDto = {
  id: string;
  ticketId: string;
  authorAccountId: string;
  body: string;
  createdAt: string;
  displayName: string | null;
};

export type SupportInternalNoteDto = {
  id: string;
  ticketId: string;
  adminId: string;
  body: string;
  createdAt: string;
};

export type SupportTicketListItemDto = {
  id: string;
  publicReference: string;
  status: SupportStatus;
  priority: SupportPriority;
  orderId: string | null;
  merchantId: string | null;
  driverId: string | null;
  assignedAdminId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupportTicketDetailDto = SupportTicketListItemDto & {
  createdByAccountId: string;
  order: SupportOrderContext | null;
  messages?: SupportMessageDto[];
  internalNotes?: SupportInternalNoteDto[];
};

export type SupportPaginatedResult<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type SupportListQuery = {
  limit: number;
  offset: number;
};

export type AdminSupportListFilters = {
  status?: SupportStatus;
  priority?: SupportPriority;
  assignedAdminId?: string;
  createdFrom?: string;
  createdTo?: string;
};

export type CreateSupportTicketInput = {
  createdByAccountId: string;
  body: string;
  orderId?: string | null;
  merchantId?: string | null;
  driverId?: string | null;
};

export function newSupportPublicReference(): string {
  return `sgt_${createUuidV7().replaceAll('-', '')}`;
}

export function toTicketListItem(
  ticket: SupportTicketRecord,
): SupportTicketListItemDto {
  return {
    id: ticket.id,
    publicReference: ticket.publicReference,
    status: ticket.status,
    priority: ticket.priority,
    orderId: ticket.orderId,
    merchantId: ticket.merchantId,
    driverId: ticket.driverId,
    assignedAdminId: ticket.assignedAdminId,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

export function toUserTicketDetail(
  ticket: SupportTicketRecord,
  order: SupportOrderContext | null,
  messages: SupportMessageDto[],
): SupportTicketDetailDto {
  return {
    ...toTicketListItem(ticket),
    createdByAccountId: ticket.createdByAccountId,
    order,
    messages,
  };
}

export function toAdminTicketDetail(
  ticket: SupportTicketRecord,
  order: SupportOrderContext | null,
  messages: SupportMessageDto[],
  internalNotes: SupportInternalNoteDto[],
): SupportTicketDetailDto {
  return {
    ...toTicketListItem(ticket),
    createdByAccountId: ticket.createdByAccountId,
    order,
    messages,
    internalNotes,
  };
}

export function initialTicketStatus(): SupportStatus {
  return SUPPORT_STATUS_OPEN;
}

export function initialTicketPriority(): SupportPriority {
  return SUPPORT_PRIORITY_NORMAL;
}
