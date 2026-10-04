import { Injectable } from '@nestjs/common';
import {
  MERCHANT_MEMBER_ROLE_MANAGER,
  MERCHANT_MEMBER_ROLE_OWNER,
  parseMerchantMemberRole,
} from '../../merchants/domain/merchant.policy';
import { MerchantAccessService } from '../../merchants/application/merchant-access.service';
import {
  supportForbidden,
  supportInvalidInput,
  supportInvalidState,
  supportNotFound,
  supportResourceForbidden,
  supportSubjectInvalid,
  supportTopicInvalid,
} from '../domain/support.errors';
import {
  SUPPORT_FAQ_AUDIENCE_MERCHANT,
  SUPPORT_MERCHANT_TOPIC_AUDIENCES,
  SUPPORT_TOPIC_AUDIENCE_MERCHANT,
  canUserReply,
  isValidSupportBody,
  normalizeSupportListQuery,
  normalizeSupportSubject,
  normalizeSupportTopicCode,
  statusAfterUserReply,
} from '../domain/support.policy';
import {
  SUPPORT_MERCHANT_FAQ_SEED,
  SUPPORT_MERCHANT_SEED_VERSION,
  SUPPORT_MERCHANT_TOPIC_SEED,
} from '../domain/support-merchant-seed';
import type {
  SupportFaqArticleDto,
  SupportTopicDto,
  SupportMessageDto,
  SupportPaginatedResult,
  SupportTicketDetailDto,
  SupportTicketListItemDto,
} from '../domain/support.types';
import {
  SUPPORT_ADMIN_DISPLAY_NAME,
  toTicketListItem,
  toUserTicketDetail,
} from '../domain/support.types';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import { SupportRepository } from '../infrastructure/support.repository';

@Injectable()
export class SupportService {
  constructor(
    private readonly support: SupportRepository,
    private readonly merchantAccess: MerchantAccessService,
  ) {}

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

  private async mapMessages(
    messages: Array<{
      id: string;
      ticketId: string;
      authorAccountId: string;
      body: string;
      createdAt: string;
    }>,
  ): Promise<SupportMessageDto[]> {
    const result: SupportMessageDto[] = [];
    for (const message of messages) {
      const isAdmin = await this.support.isAdminAuthor(message.authorAccountId);
      result.push(this.mapMessage(message, isAdmin));
    }
    return result;
  }

  private assertBody(body: string): string {
    if (!isValidSupportBody(body)) {
      throw supportInvalidInput(
        'Support message body must be 1–4000 characters',
      );
    }
    return body.trim();
  }

  // ---------------------------------------------------------------------------
  // Customer
  // ---------------------------------------------------------------------------

  async createCustomerTicket(
    accountId: string,
    body: string,
    orderId?: string,
  ): Promise<SupportTicketDetailDto> {
    const profile =
      await this.support.findCustomerProfileByAccountId(accountId);
    if (!profile) {
      throw supportForbidden('CustomerProfile is required to create Support');
    }
    const trimmed = this.assertBody(body);
    if (orderId) {
      const owned = await this.support.orderBelongsToCustomer(
        orderId,
        profile.id,
      );
      if (!owned) {
        throw supportResourceForbidden(
          'orderId must belong to the authenticated Customer',
        );
      }
    }
    const created = await this.support.runInTransaction(async (tx) =>
      this.support.createTicketWithFirstMessage(
        {
          createdByAccountId: accountId,
          body: trimmed,
          orderId: orderId ?? null,
          merchantId: null,
          driverId: null,
        },
        tx,
      ),
    );
    const order = created.ticket.orderId
      ? await this.support.findOrderSafeContext(created.ticket.orderId)
      : null;
    return toUserTicketDetail(created.ticket, order, [
      this.mapMessage(created.message, false),
    ]);
  }

  async listCustomerTickets(
    accountId: string,
    query: { limit?: number; offset?: number },
  ): Promise<SupportPaginatedResult<SupportTicketListItemDto>> {
    const profile =
      await this.support.findCustomerProfileByAccountId(accountId);
    if (!profile) {
      throw supportForbidden('CustomerProfile is required');
    }
    const { limit, offset } = normalizeSupportListQuery(query);
    const page = await this.support.listTicketsForCreator(
      accountId,
      limit,
      offset,
    );
    return {
      items: page.items.map(toTicketListItem),
      total: page.total,
      limit,
      offset,
    };
  }

  async getCustomerTicket(
    accountId: string,
    ticketId: string,
    messageQuery?: { limit?: number; offset?: number },
  ): Promise<SupportTicketDetailDto> {
    const ticket = await this.support.findTicket(ticketId);
    if (!ticket || ticket.createdByAccountId !== accountId) {
      throw supportNotFound();
    }
    return this.buildUserDetail(ticket, messageQuery);
  }

  async replyCustomerTicket(
    accountId: string,
    ticketId: string,
    body: string,
  ): Promise<SupportMessageDto> {
    const trimmed = this.assertBody(body);
    return this.support.runInTransaction(async (tx) => {
      const locked = await this.support.lockTicket(ticketId, tx);
      if (!locked || locked.createdByAccountId !== accountId) {
        throw supportNotFound();
      }
      if (!canUserReply(locked.status)) {
        throw supportInvalidState(
          'Cannot reply to a RESOLVED or CLOSED Support ticket',
        );
      }
      const nextStatus = statusAfterUserReply(locked.status);
      const message = await this.support.addMessage(
        ticketId,
        accountId,
        trimmed,
        tx,
        nextStatus !== locked.status ? { nextStatus } : undefined,
      );
      return this.mapMessage(message, false);
    });
  }

  // ---------------------------------------------------------------------------
  // Driver
  // ---------------------------------------------------------------------------

  async createDriverTicket(
    accountId: string,
    body: string,
    orderId?: string,
  ): Promise<SupportTicketDetailDto> {
    const profile = await this.support.findDriverProfileByAccountId(accountId);
    if (!profile) {
      throw supportForbidden('DriverProfile is required to create Support');
    }
    const trimmed = this.assertBody(body);
    if (orderId) {
      const assigned = await this.support.orderAssignedToDriver(
        orderId,
        profile.id,
      );
      if (!assigned) {
        throw supportResourceForbidden(
          'orderId must have a Delivery assignment for this Driver',
        );
      }
    }
    const created = await this.support.runInTransaction(async (tx) =>
      this.support.createTicketWithFirstMessage(
        {
          createdByAccountId: accountId,
          body: trimmed,
          orderId: orderId ?? null,
          merchantId: null,
          driverId: profile.id,
        },
        tx,
      ),
    );
    const order = created.ticket.orderId
      ? await this.support.findOrderSafeContext(created.ticket.orderId)
      : null;
    return toUserTicketDetail(created.ticket, order, [
      this.mapMessage(created.message, false),
    ]);
  }

  async listDriverTickets(
    accountId: string,
    query: { limit?: number; offset?: number },
  ): Promise<SupportPaginatedResult<SupportTicketListItemDto>> {
    const profile = await this.support.findDriverProfileByAccountId(accountId);
    if (!profile) {
      throw supportForbidden('DriverProfile is required');
    }
    const { limit, offset } = normalizeSupportListQuery(query);
    const page = await this.support.listTicketsForDriver(
      accountId,
      profile.id,
      limit,
      offset,
    );
    return {
      items: page.items.map(toTicketListItem),
      total: page.total,
      limit,
      offset,
    };
  }

  async getDriverTicket(
    accountId: string,
    ticketId: string,
    messageQuery?: { limit?: number; offset?: number },
  ): Promise<SupportTicketDetailDto> {
    const profile = await this.support.findDriverProfileByAccountId(accountId);
    if (!profile) {
      throw supportForbidden('DriverProfile is required');
    }
    const ticket = await this.support.findTicket(ticketId);
    if (
      !ticket ||
      (ticket.createdByAccountId !== accountId &&
        ticket.driverId !== profile.id)
    ) {
      throw supportNotFound();
    }
    return this.buildUserDetail(ticket, messageQuery);
  }

  async replyDriverTicket(
    accountId: string,
    ticketId: string,
    body: string,
  ): Promise<SupportMessageDto> {
    const profile = await this.support.findDriverProfileByAccountId(accountId);
    if (!profile) {
      throw supportForbidden('DriverProfile is required');
    }
    const trimmed = this.assertBody(body);
    return this.support.runInTransaction(async (tx) => {
      const locked = await this.support.lockTicket(ticketId, tx);
      if (
        !locked ||
        (locked.createdByAccountId !== accountId &&
          locked.driverId !== profile.id)
      ) {
        throw supportNotFound();
      }
      if (!canUserReply(locked.status)) {
        throw supportInvalidState(
          'Cannot reply to a RESOLVED or CLOSED Support ticket',
        );
      }
      const nextStatus = statusAfterUserReply(locked.status);
      const message = await this.support.addMessage(
        ticketId,
        accountId,
        trimmed,
        tx,
        nextStatus !== locked.status ? { nextStatus } : undefined,
      );
      return this.mapMessage(message, false);
    });
  }

  // ---------------------------------------------------------------------------
  // Merchant
  // ---------------------------------------------------------------------------

  private async requireMerchantSupportAccess(
    accountId: string,
    merchantId: string,
  ): Promise<void> {
    const context = await this.merchantAccess.requireMembership(
      accountId,
      merchantId,
    );
    const role = parseMerchantMemberRole(context.member.role);
    if (
      role !== MERCHANT_MEMBER_ROLE_OWNER &&
      role !== MERCHANT_MEMBER_ROLE_MANAGER
    ) {
      throw supportForbidden(
        'Only OWNER or MANAGER may access Merchant Support',
      );
    }
  }

  async createMerchantTicket(
    accountId: string,
    merchantId: string,
    input: {
      body: string;
      orderId?: string;
      topicCode?: string | null;
      subject?: string | null;
    },
  ): Promise<SupportTicketDetailDto> {
    await this.requireMerchantSupportAccess(accountId, merchantId);
    const subject = normalizeSupportSubject(input.subject);
    if (subject === null) {
      throw supportSubjectInvalid();
    }
    const topicCode = normalizeSupportTopicCode(input.topicCode);
    if (topicCode === null) {
      throw supportTopicInvalid('topicCode is required');
    }
    const trimmed = this.assertBody(input.body);
    await this.requireActiveMerchantTopic(topicCode);
    const orderId = input.orderId;
    if (orderId) {
      const owned = await this.support.orderBelongsToMerchant(
        orderId,
        merchantId,
      );
      if (!owned) {
        throw supportResourceForbidden('orderId must belong to this Merchant');
      }
    }
    const created = await this.support.runInTransaction(async (tx) =>
      this.support.createTicketWithFirstMessage(
        {
          createdByAccountId: accountId,
          body: trimmed,
          orderId: orderId ?? null,
          merchantId,
          driverId: null,
          topicCode,
          subject,
        },
        tx,
      ),
    );
    const order = created.ticket.orderId
      ? await this.support.findOrderSafeContext(created.ticket.orderId)
      : null;
    return toUserTicketDetail(created.ticket, order, [
      this.mapMessage(created.message, false),
    ]);
  }

  async listMerchantTopics(
    accountId: string,
    merchantId: string,
  ): Promise<{ topics: SupportTopicDto[] }> {
    await this.requireMerchantSupportAccess(accountId, merchantId);
    await this.ensureMerchantSupportSeed();
    const rows = await this.support.listActiveTopics([
      ...SUPPORT_MERCHANT_TOPIC_AUDIENCES,
    ]);
    return {
      topics: rows.map((row) => ({
        code: row.code,
        labelFr: row.labelFr,
        sortOrder: row.sortOrder,
      })),
    };
  }

  async listMerchantFaq(
    accountId: string,
    merchantId: string,
  ): Promise<{ articles: SupportFaqArticleDto[] }> {
    await this.requireMerchantSupportAccess(accountId, merchantId);
    await this.ensureMerchantSupportSeed();
    const rows = await this.support.listActiveFaq(
      SUPPORT_FAQ_AUDIENCE_MERCHANT,
    );
    return {
      articles: rows.map((row) => ({
        slug: row.slug,
        titleFr: row.titleFr,
        bodyFr: row.bodyFr,
        version: row.version,
        publishedAt: row.publishedAt,
      })),
    };
  }

  private async requireActiveMerchantTopic(topicCode: string): Promise<void> {
    const audiences = [...SUPPORT_MERCHANT_TOPIC_AUDIENCES];
    let topic = await this.support.findActiveTopicByCode(topicCode, audiences);
    if (!topic) {
      await this.ensureMerchantSupportSeed();
      topic = await this.support.findActiveTopicByCode(topicCode, audiences);
    }
    if (!topic) {
      throw supportTopicInvalid();
    }
  }

  /**
   * Seeds default Merchant topics / FAQ only when the audience has no rows at
   * all (so Admin-deactivated rows are never resurrected). Unique violations
   * from a concurrent first request are ignored.
   */
  async ensureMerchantSupportSeed(): Promise<void> {
    if (
      (await this.support.countTopicsForAudience(
        SUPPORT_TOPIC_AUDIENCE_MERCHANT,
      )) === 0
    ) {
      for (const topic of SUPPORT_MERCHANT_TOPIC_SEED) {
        try {
          await this.support.createTopic({
            ...topic,
            audience: SUPPORT_TOPIC_AUDIENCE_MERCHANT,
          });
        } catch (error) {
          if (!isPostgresUniqueViolation(error)) {
            throw error;
          }
        }
      }
    }
    if (
      (await this.support.countFaqForAudience(
        SUPPORT_FAQ_AUDIENCE_MERCHANT,
      )) === 0
    ) {
      for (const article of SUPPORT_MERCHANT_FAQ_SEED) {
        try {
          await this.support.createFaqArticle({
            ...article,
            audience: SUPPORT_FAQ_AUDIENCE_MERCHANT,
            version: SUPPORT_MERCHANT_SEED_VERSION,
          });
        } catch (error) {
          if (!isPostgresUniqueViolation(error)) {
            throw error;
          }
        }
      }
    }
  }

  async listMerchantTickets(
    accountId: string,
    merchantId: string,
    query: { limit?: number; offset?: number },
  ): Promise<SupportPaginatedResult<SupportTicketListItemDto>> {
    await this.requireMerchantSupportAccess(accountId, merchantId);
    const { limit, offset } = normalizeSupportListQuery(query);
    const page = await this.support.listTicketsForMerchant(
      merchantId,
      limit,
      offset,
    );
    return {
      items: page.items.map(toTicketListItem),
      total: page.total,
      limit,
      offset,
    };
  }

  async getMerchantTicket(
    accountId: string,
    merchantId: string,
    ticketId: string,
    messageQuery?: { limit?: number; offset?: number },
  ): Promise<SupportTicketDetailDto> {
    await this.requireMerchantSupportAccess(accountId, merchantId);
    const ticket = await this.support.findTicket(ticketId);
    if (!ticket || ticket.merchantId !== merchantId) {
      throw supportNotFound();
    }
    return this.buildUserDetail(ticket, messageQuery);
  }

  async replyMerchantTicket(
    accountId: string,
    merchantId: string,
    ticketId: string,
    body: string,
  ): Promise<SupportMessageDto> {
    await this.requireMerchantSupportAccess(accountId, merchantId);
    const trimmed = this.assertBody(body);
    return this.support.runInTransaction(async (tx) => {
      const locked = await this.support.lockTicket(ticketId, tx);
      if (!locked || locked.merchantId !== merchantId) {
        throw supportNotFound();
      }
      if (!canUserReply(locked.status)) {
        throw supportInvalidState(
          'Cannot reply to a RESOLVED or CLOSED Support ticket',
        );
      }
      const nextStatus = statusAfterUserReply(locked.status);
      const message = await this.support.addMessage(
        ticketId,
        accountId,
        trimmed,
        tx,
        nextStatus !== locked.status ? { nextStatus } : undefined,
      );
      return this.mapMessage(message, false);
    });
  }

  private async buildUserDetail(
    ticket: {
      id: string;
      publicReference: string;
      createdByAccountId: string;
      orderId: string | null;
      merchantId: string | null;
      driverId: string | null;
      status: import('../domain/support.policy').SupportStatus;
      priority: import('../domain/support.policy').SupportPriority;
      assignedAdminId: string | null;
      topicCode: string | null;
      subject: string | null;
      createdAt: string;
      updatedAt: string;
    },
    messageQuery?: { limit?: number; offset?: number },
  ): Promise<SupportTicketDetailDto> {
    const { limit, offset } = normalizeSupportListQuery(messageQuery ?? {});
    const messagesPage = await this.support.listMessages(
      ticket.id,
      limit,
      offset,
    );
    const order = ticket.orderId
      ? await this.support.findOrderSafeContext(ticket.orderId)
      : null;
    const messages = await this.mapMessages(messagesPage.items);
    // User detail never includes internal notes.
    return toUserTicketDetail(ticket, order, messages);
  }
}
