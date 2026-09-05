export type SettingValueType = 'string' | 'boolean' | 'integer';

export type SettingClassification =
  | 'PLATFORM_SETTING'
  | 'DOMAIN_SETTING'
  | 'ENVIRONMENT_SECRET'
  | 'DEPLOYMENT_CONFIG'
  | 'IMMUTABLE_FROZEN_RULE';

export type SettingMutability =
  | 'MUTABLE'
  | 'READ_ONLY'
  | 'INTERNAL_ONLY'
  | 'ENVIRONMENT_SECRET'
  | 'DOMAIN_OWNED';

export type SettingValueSource = 'DATABASE' | 'APPLICATION_DEFAULT';

/** Envelope persisted in PlatformSetting.valueJson. */
export type PlatformSettingStoredEnvelope = {
  value: string | boolean | number;
};

export type SettingDefinition = {
  key: string;
  valueType: SettingValueType;
  classification: 'PLATFORM_SETTING';
  mutability: 'MUTABLE';
  /** Application default when no PlatformSetting row exists. */
  defaultValue: string | boolean | number;
  description: string;
  /** When a change becomes observable to readers. */
  effectiveTime: 'IMMEDIATE_NEXT_READ';
  auditAction: string;
  maxLength?: number;
};

export type SettingView = {
  key: string;
  value: string | boolean | number;
  valueType: SettingValueType;
  source: SettingValueSource;
  classification: SettingClassification;
  mutability: SettingMutability;
  /**
   * Admin Settings API: committed value is visible on the next read request.
   * Does NOT imply Customer/Merchant/Driver app propagation (none in v1.0).
   */
  effectiveTime: 'IMMEDIATE_NEXT_READ';
  updatedAt: string | null;
};

export type PlatformSettingRow = {
  id: string;
  key: string;
  valueJson: unknown;
  updatedByAdminId: string;
  updatedAt: string;
};
