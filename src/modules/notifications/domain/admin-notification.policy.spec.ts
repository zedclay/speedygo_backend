import {
  adminNotificationGroupFor,
  adminNotificationHrefFor,
  adminNotificationPermissionFor,
  filterAdminTypeQuery,
  resolveVisibleAdminNotificationTypes,
} from './admin-notification.policy';
import {
  NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
  NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF,
  NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET,
} from './notification.types';

describe('admin-notification.policy', () => {
  it('maps types to permissions and groups', () => {
    expect(
      adminNotificationPermissionFor(NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF),
    ).toBe('drivers.verify');
    expect(
      adminNotificationPermissionFor(NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF),
    ).toBe('merchants.verify');
    expect(
      adminNotificationPermissionFor(NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET),
    ).toBe('support.read');
    expect(
      adminNotificationGroupFor(NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET),
    ).toBe('support');
    expect(adminNotificationGroupFor(NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF)).toBe(
      'verification',
    );
  });

  it('builds deep links', () => {
    const id = '0d00c091-d000-7000-8000-000000000202';
    expect(adminNotificationHrefFor(NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF, id)).toBe(
      `/drivers/${id}/verification`,
    );
    expect(
      adminNotificationHrefFor(NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF, id),
    ).toBe(`/merchants/${id}/verification`);
    expect(
      adminNotificationHrefFor(NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET, id),
    ).toBe(`/support/${id}`);
  });

  it('resolves visible types from permissions', () => {
    expect(resolveVisibleAdminNotificationTypes(['audit.read'])).toEqual([]);
    expect(
      resolveVisibleAdminNotificationTypes(['drivers.verify', 'support.read']),
    ).toEqual([
      NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
      NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET,
    ]);
    expect(
      filterAdminTypeQuery('ADMIN_SUPPORT_TICKET,nope', [
        NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET,
        NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
      ]),
    ).toEqual([NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET]);
  });
});
