import { Injectable } from '@nestjs/common';
import {
  adminNotificationGroupFor,
  adminNotificationHrefFor,
  filterAdminTypeQuery,
  isAdminNotificationType,
  resolveVisibleAdminNotificationTypes,
} from '../../notifications/domain/admin-notification.policy';
import {
  normalizeNotificationListQuery,
  parseNotificationCategory,
} from '../../notifications/domain/notification.policy';
import { notificationNotFound } from '../../notifications/domain/notification.errors';
import {
  NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF,
} from '../../notifications/domain/notification.types';
import { NotificationRepository } from '../../notifications/infrastructure/notification.repository';
import type { CurrentAdminContext } from '../domain/admin.types';

export type AdminNotificationItem = {
  id: string;
  type: string;
  /** Idempotency source (ticket / driver / merchant submission). */
  sourceId: string;
  /** Deep-link entity (ticket / driver / merchant). */
  entityId: string;
  group: 'verification' | 'support';
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  href: string;
};

export type AdminNotificationListResult = {
  items: AdminNotificationItem[];
  total: number;
  limit: number;
  offset: number;
  unreadCount: number;
  visibleTypes: string[];
};

@Injectable()
export class AdminNotificationsService {
  constructor(private readonly notifications: NotificationRepository) {}

  async list(
    admin: CurrentAdminContext,
    query: { limit?: number; offset?: number; unreadOnly?: boolean; types?: string },
  ): Promise<AdminNotificationListResult> {
    const visible = resolveVisibleAdminNotificationTypes(admin.permissions);
    const types = filterAdminTypeQuery(query.types, visible);
    const page = normalizeNotificationListQuery(query);
    if (types.length === 0) {
      return {
        items: [],
        total: 0,
        limit: page.limit,
        offset: page.offset,
        unreadCount: 0,
        visibleTypes: [],
      };
    }
    const listed = await this.notifications.listForAccountFiltered(
      admin.accountId,
      {
        categoryPrefixes: types,
        unreadOnly: Boolean(query.unreadOnly),
        limit: page.limit,
        offset: page.offset,
      },
    );
    const items = await this.toItems(listed.items);
    return {
      items,
      total: listed.total,
      limit: page.limit,
      offset: page.offset,
      unreadCount: listed.unreadCount,
      visibleTypes: types,
    };
  }

  async unreadCount(
    admin: CurrentAdminContext,
  ): Promise<{ unreadCount: number; visibleTypes: string[] }> {
    const visible = resolveVisibleAdminNotificationTypes(admin.permissions);
    if (visible.length === 0) {
      return { unreadCount: 0, visibleTypes: [] };
    }
    const listed = await this.notifications.listForAccountFiltered(
      admin.accountId,
      {
        categoryPrefixes: visible,
        limit: 1,
        offset: 0,
      },
    );
    return { unreadCount: listed.unreadCount, visibleTypes: visible };
  }

  async markRead(
    admin: CurrentAdminContext,
    notificationId: string,
  ): Promise<AdminNotificationItem> {
    const owned = await this.notifications.findOwned(
      admin.accountId,
      notificationId,
    );
    if (!owned || !this.isVisibleTo(admin, owned.category)) {
      throw notificationNotFound();
    }
    const updated = await this.notifications.markRead(
      admin.accountId,
      notificationId,
    );
    const [item] = await this.toItems([updated]);
    return item;
  }

  async markAllRead(
    admin: CurrentAdminContext,
  ): Promise<{ marked: number; visibleTypes: string[] }> {
    const visible = resolveVisibleAdminNotificationTypes(admin.permissions);
    if (visible.length === 0) {
      return { marked: 0, visibleTypes: [] };
    }
    const marked = await this.notifications.markAllReadFiltered(
      admin.accountId,
      visible,
    );
    return { marked, visibleTypes: visible };
  }

  private isVisibleTo(admin: CurrentAdminContext, category: string): boolean {
    try {
      const { type } = parseNotificationCategory(category);
      if (!isAdminNotificationType(type)) return false;
      const visible = resolveVisibleAdminNotificationTypes(admin.permissions);
      return visible.includes(type);
    } catch {
      return false;
    }
  }

  private async toItems(
    rows: Array<{
      id: string;
      category: string;
      title: string;
      body: string;
      read: boolean;
      createdAt: string;
    }>,
  ): Promise<AdminNotificationItem[]> {
    const merchantSubmissionIds: string[] = [];
    const parsed = rows.map((row) => {
      const { type, sourceId } = parseNotificationCategory(row.category);
      if (!isAdminNotificationType(type)) {
        throw notificationNotFound();
      }
      if (type === NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF) {
        merchantSubmissionIds.push(sourceId);
      }
      return { row, type, sourceId };
    });
    const merchantBySubmission =
      await this.notifications.findMerchantIdsBySubmissionIds(
        merchantSubmissionIds,
      );
    return parsed.map(({ row, type, sourceId }) => {
      const entityId =
        type === NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF
          ? (merchantBySubmission.get(sourceId) ?? sourceId)
          : sourceId;
      return {
        id: row.id,
        type,
        sourceId,
        entityId,
        group: adminNotificationGroupFor(type),
        title: row.title,
        body: row.body,
        read: row.read,
        createdAt: row.createdAt,
        href: adminNotificationHrefFor(type, entityId),
      };
    });
  }
}
