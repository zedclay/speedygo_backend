import { createHash } from 'node:crypto';

/** ASCII 'SGAR' — SpeedyGo Admin RBAC advisory lock class. */
export const ADMIN_RBAC_ADVISORY_LOCK_CLASS = 0x53474152;

export function adminRbacPrivilegeLockObjectId(privilegeCode: string): number {
  const digest = createHash('sha256')
    .update('speedygo.admin_rbac.privilege\0')
    .update(privilegeCode)
    .digest();
  const value = digest.readInt32BE(0);
  return value === 0 ? 1 : value;
}
