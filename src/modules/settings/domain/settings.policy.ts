import {
  getSettingDefinition,
  isAllowlistedSettingKey,
} from './settings.registry';
import {
  settingIntegrity,
  settingInvalidValue,
  settingNotSupported,
} from './settings.errors';
import type {
  PlatformSettingStoredEnvelope,
  SettingDefinition,
  SettingView,
} from './settings.types';

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const PHONE_RE = /^\+[1-9]\d{6,14}$/;

const HTML_TAG_RE = /<[^>]*>/;

export function requireAllowlistedDefinition(key: string): SettingDefinition {
  const def = getSettingDefinition(key);
  if (!def || !isAllowlistedSettingKey(key)) {
    throw settingNotSupported(`Setting key is not supported: ${key}`);
  }
  return def;
}

export function normalizeIncomingValue(
  def: SettingDefinition,
  raw: unknown,
): string | boolean | number {
  if (def.valueType === 'string') {
    if (typeof raw !== 'string') {
      throw settingInvalidValue(`Setting ${def.key} requires a string value`);
    }
    const trimmed = raw.trim();
    const max = def.maxLength ?? 255;
    if (trimmed.length > max) {
      throw settingInvalidValue(`Setting ${def.key} exceeds max length ${max}`);
    }
    if (HTML_TAG_RE.test(trimmed)) {
      throw settingInvalidValue(
        `Setting ${def.key} must be plain text (HTML not allowed)`,
      );
    }
    if (def.key.endsWith('Email')) {
      if (trimmed.length > 0 && !EMAIL_RE.test(trimmed)) {
        throw settingInvalidValue(
          `Setting ${def.key} must be empty or a valid email`,
        );
      }
    }
    if (def.key.endsWith('Phone')) {
      if (trimmed.length > 0 && !PHONE_RE.test(trimmed)) {
        throw settingInvalidValue(
          `Setting ${def.key} must be empty or E.164 (+country…)`,
        );
      }
    }
    return trimmed;
  }

  if (def.valueType === 'boolean') {
    if (typeof raw !== 'boolean') {
      throw settingInvalidValue(`Setting ${def.key} requires a boolean value`);
    }
    return raw;
  }

  if (def.valueType === 'integer') {
    if (
      typeof raw !== 'number' ||
      !Number.isInteger(raw) ||
      !Number.isSafeInteger(raw)
    ) {
      throw settingInvalidValue(
        `Setting ${def.key} requires a safe integer value`,
      );
    }
    return raw;
  }

  throw settingInvalidValue(`Unsupported value type for ${def.key}`);
}

export function parseStoredEnvelope(
  def: SettingDefinition,
  valueJson: unknown,
): string | boolean | number {
  if (
    valueJson === null ||
    typeof valueJson !== 'object' ||
    Array.isArray(valueJson)
  ) {
    throw settingIntegrity(
      `Corrupt PlatformSetting envelope for key ${def.key}`,
    );
  }
  const envelope = valueJson as PlatformSettingStoredEnvelope;
  if (!Object.prototype.hasOwnProperty.call(envelope, 'value')) {
    throw settingIntegrity(
      `Corrupt PlatformSetting envelope for key ${def.key}: missing value`,
    );
  }
  const stored = envelope.value;
  if (def.valueType === 'string') {
    if (typeof stored !== 'string') {
      throw settingIntegrity(
        `Corrupt PlatformSetting value type for key ${def.key}`,
      );
    }
    return stored;
  }
  if (def.valueType === 'boolean') {
    if (typeof stored !== 'boolean') {
      throw settingIntegrity(
        `Corrupt PlatformSetting value type for key ${def.key}`,
      );
    }
    return stored;
  }
  if (def.valueType === 'integer') {
    if (typeof stored !== 'number' || !Number.isInteger(stored)) {
      throw settingIntegrity(
        `Corrupt PlatformSetting value type for key ${def.key}`,
      );
    }
    return stored;
  }
  throw settingIntegrity(`Unsupported stored type for key ${def.key}`);
}

export function toStoredEnvelope(
  value: string | boolean | number,
): PlatformSettingStoredEnvelope {
  return { value };
}

export function valuesEqual(
  a: string | boolean | number,
  b: string | boolean | number,
): boolean {
  return a === b;
}

export function toSettingView(input: {
  def: SettingDefinition;
  value: string | boolean | number;
  source: 'DATABASE' | 'APPLICATION_DEFAULT';
  updatedAt: string | null;
}): SettingView {
  return {
    key: input.def.key,
    value: input.value,
    valueType: input.def.valueType,
    source: input.source,
    classification: input.def.classification,
    mutability: input.def.mutability,
    effectiveTime: input.def.effectiveTime,
    updatedAt: input.updatedAt,
  };
}
