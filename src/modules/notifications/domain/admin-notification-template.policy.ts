import {
  NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
  NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF,
  NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET,
  type NotificationTypeAdminV1,
} from './notification.types';
import {
  copyAdminDriverVerification,
  copyAdminMerchantVerification,
  copyAdminSupportTicket,
} from './admin-notification.policy';

export const ADMIN_TEMPLATE_AUDIENCE = 'ADMIN';
export const ADMIN_TEMPLATE_CHANNEL_IN_APP = 'IN_APP';
export const ADMIN_TEMPLATE_LOCALES = ['fr', 'ar'] as const;
export type AdminTemplateLocale = (typeof ADMIN_TEMPLATE_LOCALES)[number];

/**
 * Default emit locale when AdminProfile.preferredLocale is missing/invalid.
 * Never inferred from Driver/Merchant/Customer source actors.
 */
export const ADMIN_TEMPLATE_DEFAULT_EMIT_LOCALE: AdminTemplateLocale = 'fr';

/** @deprecated Use ADMIN_TEMPLATE_DEFAULT_EMIT_LOCALE — retained for call-site clarity. */
export const ADMIN_TEMPLATE_EMIT_LOCALE = ADMIN_TEMPLATE_DEFAULT_EMIT_LOCALE;

export function normalizeAdminTemplateLocale(
  raw: string | null | undefined,
): AdminTemplateLocale {
  return raw === 'ar' ? 'ar' : 'fr';
}

export const ADMIN_TEMPLATE_PLACEHOLDERS: Record<
  NotificationTypeAdminV1,
  readonly string[]
> = {
  [NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF]: ['driverFullName'],
  [NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF]: [
    'merchantName',
    'publicReference',
  ],
  [NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET]: ['publicReference', 'subject'],
};

export const ADMIN_TEMPLATE_DISPLAY_NAME_FR: Record<
  NotificationTypeAdminV1,
  string
> = {
  [NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF]: 'Vérification livreur (Admin)',
  [NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF]: 'Vérification commerçant (Admin)',
  [NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET]: 'Ticket Support (Admin)',
};

export const ADMIN_TEMPLATE_DEFAULTS: Record<
  NotificationTypeAdminV1,
  Record<AdminTemplateLocale, { title: string; body: string }>
> = {
  [NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF]: {
    fr: {
      title: 'Vérification livreur à examiner',
      body: 'Documents du livreur {{driverFullName}} soumis pour revue.',
    },
    ar: {
      title: 'تحقق السائق للمراجعة',
      body: 'تم تقديم وثائق السائق {{driverFullName}} للمراجعة.',
    },
  },
  [NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF]: {
    fr: {
      title: 'Vérification commerçant à examiner',
      body: 'Dossier {{publicReference}} ({{merchantName}}) soumis pour revue.',
    },
    ar: {
      title: 'تحقق التاجر للمراجعة',
      body: 'تم تقديم ملف {{publicReference}} ({{merchantName}}) للمراجعة.',
    },
  },
  [NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET]: {
    fr: {
      title: 'Nouveau ticket Support',
      body: '{{publicReference}} — {{subject}}',
    },
    ar: {
      title: 'تذكرة دعم جديدة',
      body: '{{publicReference}} — {{subject}}',
    },
  },
};

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export function adminTemplateCode(
  type: NotificationTypeAdminV1,
  locale: AdminTemplateLocale,
): string {
  return `${type}__${locale}`;
}

export function parseAdminTemplateCode(
  code: string,
): { type: NotificationTypeAdminV1; locale: AdminTemplateLocale } | null {
  const sep = code.lastIndexOf('__');
  if (sep <= 0) return null;
  const type = code.slice(0, sep);
  const locale = code.slice(sep + 2);
  if (
    !(
      type === NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF ||
      type === NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF ||
      type === NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET
    )
  ) {
    return null;
  }
  if (locale !== 'fr' && locale !== 'ar') return null;
  return { type, locale };
}

export function extractPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    found.add(m[1]!);
  }
  return [...found];
}

export function validateAdminTemplatePlaceholders(
  type: NotificationTypeAdminV1,
  title: string,
  body: string,
): { ok: true } | { ok: false; message: string } {
  const allowed = new Set(ADMIN_TEMPLATE_PLACEHOLDERS[type]);
  const used = [
    ...extractPlaceholders(title),
    ...extractPlaceholders(body),
  ];
  const unknown = used.filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `Unknown placeholders: ${[...new Set(unknown)].join(', ')}`,
    };
  }
  return { ok: true };
}

export function renderAdminTemplate(
  titleTemplate: string,
  bodyTemplate: string,
  vars: Record<string, string>,
): { title: string; body: string } {
  const sub = (tpl: string) =>
    tpl.replace(PLACEHOLDER_RE, (_, key: string) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : '',
    );
  return {
    title: sub(titleTemplate).trim(),
    body: sub(bodyTemplate).trim(),
  };
}

/**
 * Locale-scoped fallback when the catalogue row is missing/inactive/unusable.
 * Never cross-resolves the other locale's catalogue row.
 * - fr → historic copyAdmin* factories
 * - ar → seeded ADMIN_TEMPLATE_DEFAULTS.ar strings (rendered)
 */
export function factoryFallbackCopy(
  type: NotificationTypeAdminV1,
  vars: Record<string, string>,
  locale: AdminTemplateLocale = ADMIN_TEMPLATE_DEFAULT_EMIT_LOCALE,
): { title: string; body: string } {
  if (locale === 'ar') {
    const defaults = ADMIN_TEMPLATE_DEFAULTS[type].ar;
    return renderAdminTemplate(defaults.title, defaults.body, vars);
  }
  switch (type) {
    case NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF:
      return copyAdminDriverVerification({
        driverFullName: vars.driverFullName ?? '',
      });
    case NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF:
      return copyAdminMerchantVerification({
        merchantName: vars.merchantName ?? '',
        publicReference: vars.publicReference ?? '',
      });
    case NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET:
      return copyAdminSupportTicket({
        publicReference: vars.publicReference ?? '',
        subject: vars.subject ?? null,
      });
    default: {
      const _e: never = type;
      return _e;
    }
  }
}

export function examplePreviewVars(
  type: NotificationTypeAdminV1,
): Record<string, string> {
  switch (type) {
    case NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF:
      return { driverFullName: 'Exemple Livreur A006' };
    case NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF:
      return {
        merchantName: 'Exemple Commerçant',
        publicReference: 'sgm_preview_example',
      };
    case NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET:
      return {
        publicReference: 'sgt_preview_example',
        subject: 'Exemple sujet Support',
      };
    default: {
      const _e: never = type;
      return _e;
    }
  }
}

export const TITLE_MAX = 500;
export const BODY_MAX = 4000;
