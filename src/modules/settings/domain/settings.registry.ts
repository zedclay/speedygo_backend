import type { SettingDefinition } from './settings.types';

/**
 * Application allowlist of PlatformSetting keys for Settings Foundation v1.0.
 * Unknown DB keys (including former publicAnnouncement rows) are never exposed
 * or mutated through the Admin API.
 *
 * Inventory is limited to support contact presentation strings.
 * Domain economics remain owned by their foundations.
 */
export const PLATFORM_SETTING_KEYS = Object.freeze({
  SUPPORT_CONTACT_EMAIL: 'platform.supportContactEmail',
  SUPPORT_CONTACT_PHONE: 'platform.supportContactPhone',
} as const);

export type PlatformSettingKey =
  (typeof PLATFORM_SETTING_KEYS)[keyof typeof PLATFORM_SETTING_KEYS];

export const SETTINGS_AUDIT_ACTIONS = Object.freeze({
  UPDATE_SUPPORT_CONTACT_EMAIL: 'settings.update.platform.supportContactEmail',
  UPDATE_SUPPORT_CONTACT_PHONE: 'settings.update.platform.supportContactPhone',
} as const);

const REGISTRY: readonly SettingDefinition[] = Object.freeze([
  {
    key: PLATFORM_SETTING_KEYS.SUPPORT_CONTACT_EMAIL,
    valueType: 'string',
    classification: 'PLATFORM_SETTING',
    mutability: 'MUTABLE',
    defaultValue: '',
    description:
      'Public platform support contact email for Customer/Merchant/Driver surfaces (Admin-persisted; no mobile consumer in Settings v1.0).',
    effectiveTime: 'IMMEDIATE_NEXT_READ',
    auditAction: SETTINGS_AUDIT_ACTIONS.UPDATE_SUPPORT_CONTACT_EMAIL,
    maxLength: 254,
  },
  {
    key: PLATFORM_SETTING_KEYS.SUPPORT_CONTACT_PHONE,
    valueType: 'string',
    classification: 'PLATFORM_SETTING',
    mutability: 'MUTABLE',
    defaultValue: '',
    description:
      'Public platform support contact phone (E.164 preferred). Admin-persisted; no mobile consumer in Settings v1.0.',
    effectiveTime: 'IMMEDIATE_NEXT_READ',
    auditAction: SETTINGS_AUDIT_ACTIONS.UPDATE_SUPPORT_CONTACT_PHONE,
    maxLength: 32,
  },
]);

const BY_KEY = new Map(REGISTRY.map((d) => [d.key, d]));

export function listSettingDefinitions(): readonly SettingDefinition[] {
  return REGISTRY;
}

export function getSettingDefinition(
  key: string,
): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

export function isAllowlistedSettingKey(key: string): boolean {
  return BY_KEY.has(key);
}
