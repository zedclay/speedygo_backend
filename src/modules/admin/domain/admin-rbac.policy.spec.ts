import { ADMIN_PERMISSIONS } from './admin-permissions';
import {
  assertAssignablePermissionCodes,
  assertNotSelfAdmin,
  normalizeDisplayName,
  parseAccountStatus,
  uniquePermissionCodes,
} from './admin-rbac.policy';
import { AdminRbacError } from './admin-rbac.errors';

describe('admin-rbac.policy', () => {
  it('allows assigning subset of actor permissions', () => {
    expect(() =>
      assertAssignablePermissionCodes(
        [ADMIN_PERMISSIONS.ADMINS_READ, ADMIN_PERMISSIONS.ADMINS_MANAGE],
        [ADMIN_PERMISSIONS.ADMINS_READ],
      ),
    ).not.toThrow();
  });

  it('rejects privilege escalation with PRIVILEGE_GRANT_FORBIDDEN', () => {
    try {
      assertAssignablePermissionCodes(
        [ADMIN_PERMISSIONS.ADMINS_READ],
        [ADMIN_PERMISSIONS.ADMINS_MANAGE],
      );
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AdminRbacError);
      expect((e as AdminRbacError).code).toBe(
        'ADMIN_RBAC_PRIVILEGE_GRANT_FORBIDDEN',
      );
    }
  });

  it('forbids self targeting', () => {
    expect(() => assertNotSelfAdmin('a', 'a', 'change role')).toThrow(
      AdminRbacError,
    );
  });

  it('parses account status', () => {
    expect(parseAccountStatus('SUSPENDED')).toBe('SUSPENDED');
    expect(() => parseAccountStatus('BANNED')).toThrow(AdminRbacError);
  });

  it('normalizes display name and unique codes', () => {
    expect(normalizeDisplayName('  Ada  ')).toBe('Ada');
    expect(
      uniquePermissionCodes([
        ADMIN_PERMISSIONS.ADMINS_READ,
        ADMIN_PERMISSIONS.ADMINS_READ,
      ]),
    ).toEqual([ADMIN_PERMISSIONS.ADMINS_READ]);
  });
});
