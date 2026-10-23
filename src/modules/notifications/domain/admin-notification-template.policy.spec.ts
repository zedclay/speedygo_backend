import {
  ADMIN_TEMPLATE_DEFAULTS,
  adminTemplateCode,
  extractPlaceholders,
  factoryFallbackCopy,
  parseAdminTemplateCode,
  renderAdminTemplate,
  validateAdminTemplatePlaceholders,
} from './admin-notification-template.policy';
import {
  NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
  NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF,
  NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET,
} from './notification.types';

describe('admin-notification-template.policy', () => {
  it('builds and parses catalogue codes', () => {
    const code = adminTemplateCode(NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF, 'fr');
    expect(code).toBe('ADMIN_DRIVER_VERIF__fr');
    expect(parseAdminTemplateCode(code)).toEqual({
      type: NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
      locale: 'fr',
    });
    expect(parseAdminTemplateCode('UNKNOWN__fr')).toBeNull();
  });

  it('rejects unknown placeholders on save', () => {
    const bad = validateAdminTemplatePlaceholders(
      NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
      'Hi',
      'Hello {{driverFullName}} and {{evil}}',
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.message).toContain('evil');
    }
    const ok = validateAdminTemplatePlaceholders(
      NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF,
      'T',
      '{{merchantName}} / {{publicReference}}',
    );
    expect(ok.ok).toBe(true);
  });

  it('renders closed placeholders without evaluating expressions', () => {
    const rendered = renderAdminTemplate(
      'Title {{driverFullName}}',
      'Body {{driverFullName}} {{missing}}',
      { driverFullName: 'Ada' },
    );
    expect(rendered).toEqual({ title: 'Title Ada', body: 'Body Ada' });
    expect(extractPlaceholders('a {{x}} b {{y}}')).toEqual(['x', 'y']);
  });

  it('factory fallback matches defaults for support subject null', () => {
    const copy = factoryFallbackCopy(NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET, {
      publicReference: 'sgt_1',
      subject: '',
    });
    expect(copy.title).toBe(
      ADMIN_TEMPLATE_DEFAULTS[NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET].fr.title,
    );
    expect(copy.body).toContain('sgt_1');
  });

  it('AR factory fallback uses AR seed defaults for all three types', () => {
    const driver = factoryFallbackCopy(
      NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
      { driverFullName: 'Ada' },
      'ar',
    );
    expect(driver.title).toBe(
      ADMIN_TEMPLATE_DEFAULTS[NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF].ar.title,
    );
    expect(driver.body).toContain('Ada');

    const merchant = factoryFallbackCopy(
      NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF,
      { merchantName: 'M', publicReference: 'sgm_1' },
      'ar',
    );
    expect(merchant.title).toBe(
      ADMIN_TEMPLATE_DEFAULTS[NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF].ar.title,
    );
    expect(merchant.body).toContain('sgm_1');

    const support = factoryFallbackCopy(
      NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET,
      { publicReference: 'sgt_1', subject: 'Hello' },
      'ar',
    );
    expect(support.title).toBe(
      ADMIN_TEMPLATE_DEFAULTS[NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET].ar.title,
    );
    expect(support.body).toContain('Hello');
  });
});
