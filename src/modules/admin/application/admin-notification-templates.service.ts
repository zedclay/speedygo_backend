import { Injectable } from '@nestjs/common';
import {
  ADMIN_TEMPLATE_AUDIENCE,
  ADMIN_TEMPLATE_CHANNEL_IN_APP,
  ADMIN_TEMPLATE_DISPLAY_NAME_FR,
  ADMIN_TEMPLATE_PLACEHOLDERS,
  BODY_MAX,
  TITLE_MAX,
  examplePreviewVars,
  parseAdminTemplateCode,
  renderAdminTemplate,
  validateAdminTemplatePlaceholders,
} from '../../notifications/domain/admin-notification-template.policy';
import { NotificationRepository } from '../../notifications/infrastructure/notification.repository';
import { NotificationService } from '../../notifications/application/notification.service';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import { adminInvalidInput, adminNotFound } from '../domain/admin.errors';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminAuditService } from './admin-audit.service';

export type AdminNotificationTemplateView = {
  id: string;
  code: string;
  type: string;
  locale: string;
  displayName: string;
  audience: string;
  trigger: string;
  channel: string;
  titleTemplate: string;
  bodyTemplate: string;
  active: boolean;
  editable: boolean;
  placeholders: readonly string[];
  createdAt: string;
  updatedAt: string;
};

export type AdminNotificationTemplateListResult = {
  items: AdminNotificationTemplateView[];
  deferredChannels: readonly string[];
};

export type AdminNotificationTemplatePreviewResult = {
  title: string;
  body: string;
  exampleVars: Record<string, string>;
  exampleLabel: string;
};

@Injectable()
export class AdminNotificationTemplatesService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly notificationService: NotificationService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(): Promise<AdminNotificationTemplateListResult> {
    await this.notificationService.ensureAdminNotificationTemplates();
    const rows = await this.notifications.listAdminNotificationTemplates();
    const items = rows
      .map((row) => this.toView(row))
      .filter((v): v is AdminNotificationTemplateView => v != null);
    return {
      items,
      deferredChannels: ['SMS', 'EMAIL', 'PUSH'] as const,
    };
  }

  async get(id: string): Promise<AdminNotificationTemplateView> {
    await this.notificationService.ensureAdminNotificationTemplates();
    const row = await this.notifications.findNotificationTemplateById(id);
    const view = row ? this.toView(row) : null;
    if (!view) {
      throw adminNotFound('Notification template not found');
    }
    return view;
  }

  async update(
    admin: CurrentAdminContext,
    id: string,
    input: {
      titleTemplate: string;
      bodyTemplate: string;
      active: boolean;
    },
  ): Promise<AdminNotificationTemplateView> {
    const existing = await this.notifications.findNotificationTemplateById(id);
    if (!existing || !this.isEditableRow(existing)) {
      throw adminNotFound('Notification template not found');
    }
    const parsed = parseAdminTemplateCode(existing.code);
    if (!parsed) {
      throw adminNotFound('Notification template not found');
    }
    const title = input.titleTemplate.trim();
    const body = input.bodyTemplate.trim();
    if (!title || !body) {
      throw adminInvalidInput('titleTemplate and bodyTemplate are required');
    }
    if (title.length > TITLE_MAX) {
      throw adminInvalidInput(`titleTemplate exceeds ${TITLE_MAX} characters`);
    }
    if (body.length > BODY_MAX) {
      throw adminInvalidInput(`bodyTemplate exceeds ${BODY_MAX} characters`);
    }
    const placeholders = validateAdminTemplatePlaceholders(
      parsed.type,
      title,
      body,
    );
    if (!placeholders.ok) {
      throw adminInvalidInput(placeholders.message);
    }

    const before = {
      titleTemplate: existing.titleTemplate,
      bodyTemplate: existing.bodyTemplate,
      active: existing.active,
    };
    const updated = await this.notifications.updateNotificationTemplate(id, {
      titleTemplate: title,
      bodyTemplate: body,
      active: Boolean(input.active),
    });
    await this.audit.record({
      adminId: admin.adminProfileId,
      action: ADMIN_AUDIT_ACTIONS.NOTIFICATION_TEMPLATE_UPDATE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.NOTIFICATION_TEMPLATE,
      targetId: id,
      beforeJson: before,
      afterJson: {
        titleTemplate: updated.titleTemplate,
        bodyTemplate: updated.bodyTemplate,
        active: updated.active,
      },
    });
    const view = this.toView(updated);
    if (!view) {
      throw adminNotFound('Notification template not found');
    }
    return view;
  }

  async preview(
    id: string,
    input?: { titleTemplate?: string; bodyTemplate?: string },
  ): Promise<AdminNotificationTemplatePreviewResult> {
    const existing = await this.notifications.findNotificationTemplateById(id);
    if (!existing || !this.isEditableRow(existing)) {
      throw adminNotFound('Notification template not found');
    }
    const parsed = parseAdminTemplateCode(existing.code);
    if (!parsed) {
      throw adminNotFound('Notification template not found');
    }
    const titleTemplate = (
      input?.titleTemplate ?? existing.titleTemplate
    ).trim();
    const bodyTemplate = (input?.bodyTemplate ?? existing.bodyTemplate).trim();
    if (!titleTemplate || !bodyTemplate) {
      throw adminInvalidInput('titleTemplate and bodyTemplate are required');
    }
    const placeholders = validateAdminTemplatePlaceholders(
      parsed.type,
      titleTemplate,
      bodyTemplate,
    );
    if (!placeholders.ok) {
      throw adminInvalidInput(placeholders.message);
    }
    const exampleVars = examplePreviewVars(parsed.type);
    const rendered = renderAdminTemplate(
      titleTemplate,
      bodyTemplate,
      exampleVars,
    );
    return {
      title: rendered.title,
      body: rendered.body,
      exampleVars,
      exampleLabel: 'example — labelled preview data (not persisted)',
    };
  }

  private isEditableRow(row: {
    audience: string;
    channel: string;
    code: string;
  }): boolean {
    return (
      row.audience === ADMIN_TEMPLATE_AUDIENCE &&
      row.channel === ADMIN_TEMPLATE_CHANNEL_IN_APP &&
      parseAdminTemplateCode(row.code) != null
    );
  }

  private toView(row: {
    id: string;
    code: string;
    audience: string;
    trigger: string;
    channel: string;
    titleTemplate: string;
    bodyTemplate: string;
    active: boolean;
    createdAt: string;
    updatedAt: string;
  }): AdminNotificationTemplateView | null {
    const parsed = parseAdminTemplateCode(row.code);
    if (!parsed) return null;
    if (
      row.audience !== ADMIN_TEMPLATE_AUDIENCE ||
      row.channel !== ADMIN_TEMPLATE_CHANNEL_IN_APP
    ) {
      return null;
    }
    return {
      id: row.id,
      code: row.code,
      type: parsed.type,
      locale: parsed.locale,
      displayName: ADMIN_TEMPLATE_DISPLAY_NAME_FR[parsed.type],
      audience: row.audience,
      trigger: row.trigger,
      channel: row.channel,
      titleTemplate: row.titleTemplate,
      bodyTemplate: row.bodyTemplate,
      active: row.active,
      editable: true,
      placeholders: ADMIN_TEMPLATE_PLACEHOLDERS[parsed.type],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
