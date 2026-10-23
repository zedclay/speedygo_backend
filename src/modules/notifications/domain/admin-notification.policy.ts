import { ADMIN_PERMISSIONS } from '../../admin/domain/admin-permissions';
import {
  NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
  NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF,
  NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET,
  NOTIFICATION_TYPES_ADMIN_V1,
  type NotificationTypeAdminV1,
  type NotificationTypeV1,
} from './notification.types';

export const ADMIN_NOTIFICATION_PERMISSION: Record<
  NotificationTypeAdminV1,
  string
> = {
  [NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF]: ADMIN_PERMISSIONS.DRIVERS_VERIFY,
  [NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF]: ADMIN_PERMISSIONS.MERCHANTS_VERIFY,
  [NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET]: ADMIN_PERMISSIONS.SUPPORT_READ,
};

export type AdminNotificationGroup = 'verification' | 'support';

export function isAdminNotificationType(
  type: string,
): type is NotificationTypeAdminV1 {
  return (NOTIFICATION_TYPES_ADMIN_V1 as readonly string[]).includes(type);
}

export function adminNotificationPermissionFor(
  type: NotificationTypeAdminV1,
): string {
  return ADMIN_NOTIFICATION_PERMISSION[type];
}

export function adminNotificationGroupFor(
  type: NotificationTypeAdminV1,
): AdminNotificationGroup {
  if (type === NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET) {
    return 'support';
  }
  return 'verification';
}

/**
 * Deep-link target id (DriverProfile / Merchant / SupportTicket).
 * For ADMIN_MERCHANT_VERIF the notification `sourceId` is the submission id;
 * callers must pass the Merchant id as `entityId`.
 */
export function adminNotificationHrefFor(
  type: NotificationTypeAdminV1,
  entityId: string,
): string {
  switch (type) {
    case NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF:
      return `/drivers/${entityId}/verification`;
    case NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF:
      return `/merchants/${entityId}/verification`;
    case NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET:
      return `/support/${entityId}`;
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/** Types the actor may see right now (permission ∩ Admin catalogue). */
export function resolveVisibleAdminNotificationTypes(
  permissions: readonly string[],
): NotificationTypeAdminV1[] {
  return NOTIFICATION_TYPES_ADMIN_V1.filter((type) =>
    permissions.includes(ADMIN_NOTIFICATION_PERMISSION[type]),
  );
}

export function copyAdminDriverVerification(input: {
  driverFullName: string;
}): { title: string; body: string } {
  return {
    title: 'Vérification livreur à examiner',
    body: `Documents du livreur ${input.driverFullName} soumis pour revue.`,
  };
}

export function copyAdminMerchantVerification(input: {
  merchantName: string;
  publicReference: string;
}): { title: string; body: string } {
  return {
    title: 'Vérification commerçant à examiner',
    body: `Dossier ${input.publicReference} (${input.merchantName}) soumis pour revue.`,
  };
}

export function copyAdminSupportTicket(input: {
  publicReference: string;
  subject: string | null;
}): { title: string; body: string } {
  const subject = input.subject?.trim() || 'Nouveau ticket Support';
  return {
    title: 'Nouveau ticket Support',
    body: `${input.publicReference} — ${subject}`,
  };
}

export function filterAdminTypeQuery(
  raw: string | undefined,
  visible: readonly NotificationTypeAdminV1[],
): NotificationTypeAdminV1[] {
  if (!raw?.trim()) {
    return [...visible];
  }
  const wanted = raw
    .split(',')
    .map((t) => t.trim())
    .filter(isAdminNotificationType);
  const allow = new Set(visible);
  return wanted.filter((t) => allow.has(t));
}

export function assertAdminType(type: NotificationTypeV1): NotificationTypeAdminV1 {
  if (!isAdminNotificationType(type)) {
    throw new Error(`Not an Admin notification type: ${type}`);
  }
  return type;
}
