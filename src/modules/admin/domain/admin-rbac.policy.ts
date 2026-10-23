import { ADMIN_PERMISSIONS } from './admin-permissions';
import {
  adminRbacInvalidInput,
  adminRbacPrivilegeGrantForbidden,
  adminRbacSelfForbidden,
} from './admin-rbac.errors';
import {
  ADMIN_ACCOUNT_STATUSES,
  type AdminAccountStatus,
} from './admin-rbac.types';

export const ADMIN_RBAC_MANAGE_CODE = ADMIN_PERMISSIONS.ADMINS_MANAGE;
export const ADMIN_RBAC_ROLES_MANAGE_CODE = ADMIN_PERMISSIONS.ROLES_MANAGE;

/**
 * Catalogue codes the actor may assign / restore. Call only after unknown codes
 * have already been rejected as INVALID_INPUT.
 */
export function assertAssignablePermissionCodes(
  actorCodes: readonly string[],
  requested: readonly string[],
): void {
  const actorSet = new Set(actorCodes);
  const forbidden = requested.filter((code) => !actorSet.has(code));
  if (forbidden.length > 0) {
    throw adminRbacPrivilegeGrantForbidden(
      `Cannot grant or restore permissions outside actor grant: ${forbidden.join(', ')}`,
    );
  }
}

/** True when editing this Role would change the actor's own effective grant. */
export function roleIsSharedWithActor(
  actorRoleId: string,
  targetRoleId: string,
): boolean {
  return actorRoleId === targetRoleId;
}

export function assertNotSelfAdmin(
  actorAdminProfileId: string,
  targetAdminProfileId: string,
  action: string,
): void {
  if (actorAdminProfileId === targetAdminProfileId) {
    throw adminRbacSelfForbidden(`Cannot ${action} own administrator profile`);
  }
}

export function parseAccountStatus(raw: string): AdminAccountStatus {
  if (
    !(ADMIN_ACCOUNT_STATUSES as readonly string[]).includes(raw)
  ) {
    throw adminRbacInvalidInput(
      `accountStatus must be one of ${ADMIN_ACCOUNT_STATUSES.join(', ')}`,
    );
  }
  return raw as AdminAccountStatus;
}

export function normalizeRoleName(raw: string): string {
  const name = raw.trim();
  if (name.length < 2 || name.length > 128) {
    throw adminRbacInvalidInput('Role name must be 2–128 characters');
  }
  return name;
}

export function normalizeDisplayName(raw: string): string {
  const name = raw.trim();
  if (name.length < 2 || name.length > 255) {
    throw adminRbacInvalidInput('displayName must be 2–255 characters');
  }
  return name;
}

export function uniquePermissionCodes(codes: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const code of codes) {
    const c = code.trim();
    if (!c) {
      throw adminRbacInvalidInput('permissionCodes must not contain blanks');
    }
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}
