import {
  PLATFORM_SETTING_KEYS,
  getSettingDefinition,
  isAllowlistedSettingKey,
  listSettingDefinitions,
} from './settings.registry';
import {
  normalizeIncomingValue,
  parseStoredEnvelope,
  requireAllowlistedDefinition,
  toStoredEnvelope,
  valuesEqual,
} from './settings.policy';
import { SETTINGS_ERROR_CODES } from './settings.errors';

describe('Settings Foundation policy/registry', () => {
  it('exposes exactly the v1.0 two-key support-contact allowlist', () => {
    const keys = listSettingDefinitions().map((d) => d.key);
    expect(keys).toEqual([
      PLATFORM_SETTING_KEYS.SUPPORT_CONTACT_EMAIL,
      PLATFORM_SETTING_KEYS.SUPPORT_CONTACT_PHONE,
    ]);
    expect(isAllowlistedSettingKey('platform.publicAnnouncement')).toBe(false);
    for (const def of listSettingDefinitions()) {
      expect(def.classification).toBe('PLATFORM_SETTING');
      expect(def.mutability).toBe('MUTABLE');
      expect(def.effectiveTime).toBe('IMMEDIATE_NEXT_READ');
      expect(def.defaultValue).toBe('');
    }
  });

  it('rejects unknown, announcement, and financial/secret keys', () => {
    for (const key of [
      'platform.publicAnnouncement',
      'platform.publicAnnouncement.enabled',
      'platform.announcement',
      'commission.rate',
      'payment.secret',
      'jwt.secret',
      'arbitrary.foo',
    ]) {
      expect(isAllowlistedSettingKey(key)).toBe(false);
      expect(() => requireAllowlistedDefinition(key)).toThrow(
        expect.objectContaining({
          code: SETTINGS_ERROR_CODES.SETTING_NOT_SUPPORTED,
        }),
      );
    }
  });

  it('validates email and phone strings', () => {
    const email = getSettingDefinition(
      PLATFORM_SETTING_KEYS.SUPPORT_CONTACT_EMAIL,
    )!;
    const phone = getSettingDefinition(
      PLATFORM_SETTING_KEYS.SUPPORT_CONTACT_PHONE,
    )!;

    expect(normalizeIncomingValue(email, '  support@speedygo.dz ')).toBe(
      'support@speedygo.dz',
    );
    expect(normalizeIncomingValue(email, '')).toBe('');
    expect(() => normalizeIncomingValue(email, 'not-an-email')).toThrow(
      expect.objectContaining({
        code: SETTINGS_ERROR_CODES.SETTING_INVALID_VALUE,
      }),
    );
    expect(() => normalizeIncomingValue(email, true)).toThrow(
      expect.objectContaining({
        code: SETTINGS_ERROR_CODES.SETTING_INVALID_VALUE,
      }),
    );
    expect(() => normalizeIncomingValue(email, '<b>x@y.z</b>')).toThrow(
      expect.objectContaining({
        code: SETTINGS_ERROR_CODES.SETTING_INVALID_VALUE,
      }),
    );

    expect(normalizeIncomingValue(phone, '+213555123456')).toBe(
      '+213555123456',
    );
    expect(() => normalizeIncomingValue(phone, '0555123456')).toThrow(
      expect.objectContaining({
        code: SETTINGS_ERROR_CODES.SETTING_INVALID_VALUE,
      }),
    );
  });

  it('fails closed on corrupt stored envelopes', () => {
    const email = getSettingDefinition(
      PLATFORM_SETTING_KEYS.SUPPORT_CONTACT_EMAIL,
    )!;
    expect(() => parseStoredEnvelope(email, 'plain-string')).toThrow(
      expect.objectContaining({
        code: SETTINGS_ERROR_CODES.SETTING_INTEGRITY,
      }),
    );
    expect(() => parseStoredEnvelope(email, { value: 12 })).toThrow(
      expect.objectContaining({
        code: SETTINGS_ERROR_CODES.SETTING_INTEGRITY,
      }),
    );
    expect(parseStoredEnvelope(email, { value: 'a@b.co' })).toBe('a@b.co');
    expect(toStoredEnvelope('x')).toEqual({ value: 'x' });
  });

  it('idempotency equality is strict', () => {
    expect(valuesEqual('', '')).toBe(true);
    expect(valuesEqual('a', 'b')).toBe(false);
    expect(valuesEqual(true, true)).toBe(true);
  });
});
