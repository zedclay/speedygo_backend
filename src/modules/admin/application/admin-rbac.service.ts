import { Injectable } from '@nestjs/common';
import { normalizeEmail, normalizePhone } from '../../auth/domain/identity';
import { AuthError } from '../../auth/domain/auth.errors';
import { SessionService } from '../../auth/application/session.service';
import { PermissionService } from '../../authorization/permission.service';
import { PrismaService } from '../../../infrastructure/database/database.module';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import { ADMIN_PERMISSIONS } from '../domain/admin-permissions';
import {
  adminRbacDuplicate,
  adminRbacInvalidInput,
  adminRbacLastManagerProtected,
  adminRbacNotFound,
} from '../domain/admin-rbac.errors';
import {
  assertAssignablePermissionCodes,
  assertNotSelfAdmin,
  normalizeDisplayName,
  normalizeRoleName,
  parseAccountStatus,
  uniquePermissionCodes,
} from '../domain/admin-rbac.policy';
import type {
  AdminAccountStatus,
  AdminPermissionCatalogItem,
  AdminProfileDetail,
  AdminProfileListQuery,
  AdminRoleDetail,
  AdminRoleListQuery,
} from '../domain/admin-rbac.types';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminRbacRepository } from '../infrastructure/admin-rbac.repository';
import { AdminAuditService } from './admin-audit.service';

const DEFAULT_PHONE_COUNTRY = 'DZ';

@Injectable()
export class AdminRbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AdminRbacRepository,
    private readonly audit: AdminAuditService,
    private readonly permissions: PermissionService,
    private readonly sessions: SessionService,
  ) {}

  listAdmins(
    query: Partial<AdminProfileListQuery> & {
      limit?: number;
      offset?: number;
    },
  ) {
    return this.repo.listAdmins(query);
  }

  async getAdmin(id: string): Promise<AdminProfileDetail> {
    const row = await this.repo.getAdmin(id);
    if (!row) throw adminRbacNotFound('Administrator not found');
    return row;
  }

  listRoles(
    query: Partial<AdminRoleListQuery> & {
      limit?: number;
      offset?: number;
    },
  ) {
    return this.repo.listRoles(query);
  }

  async getRole(id: string): Promise<AdminRoleDetail> {
    const row = await this.repo.getRole(id);
    if (!row) throw adminRbacNotFound('Role not found');
    return row;
  }

  listPermissions(): Promise<AdminPermissionCatalogItem[]> {
    return this.repo.listPermissionCatalog();
  }

  async createAdmin(
    actor: CurrentAdminContext,
    input: {
      displayName: string;
      roleId: string;
      phone?: string;
      email?: string;
      accountStatus?: AdminAccountStatus;
    },
  ): Promise<AdminProfileDetail> {
    const displayName = normalizeDisplayName(input.displayName);
    const phone = this.optionalPhone(input.phone);
    const email = this.optionalEmail(input.email);
    if (!phone && !email) {
      throw adminRbacInvalidInput('phone or email is required for OTP login');
    }
    const requestedStatus = input.accountStatus
      ? parseAccountStatus(input.accountStatus)
      : 'ACTIVE';

    const role = await this.prisma.getDb().orm.public.Role.where({
      id: input.roleId,
    }).first();
    if (!role) throw adminRbacNotFound('Role not found');
    if (!role.active) {
      throw adminRbacInvalidInput('Cannot assign an inactive role');
    }

    const roleCodes = await this.repo.permissionCodesForRole(role.id);
    assertAssignablePermissionCodes(actor.permissions, roleCodes);

    const existingAccount = await this.resolveExistingAccountForCreate({
      phone,
      email,
    });

    /**
     * Attach path: never mutate Account.phone/email/status.
     * Status on create applies only when a new Account row is inserted.
     */
    let accountStatus = requestedStatus;
    if (existingAccount) {
      const existingProfile = await this.repo.findAdminProfileByAccountId(
        existingAccount.id,
      );
      if (existingProfile) {
        throw adminRbacDuplicate('Account already has an AdminProfile');
      }
      if (
        input.accountStatus !== undefined &&
        existingAccount.status !== requestedStatus
      ) {
        throw adminRbacInvalidInput(
          'Cannot change Account.status while attaching AdminProfile; use PATCH /admin/admins/:id after create (status is Account-wide, not Admin-only)',
        );
      }
      accountStatus = existingAccount.status as AdminAccountStatus;
    }

    const createdId = await this.prisma.getDb().transaction(async (tx) => {
      const accountId =
        existingAccount?.id ??
        (await this.repo.createAccountInTx(tx, {
          phone,
          email,
          status: accountStatus,
        }));
      const profileId = await this.repo.createAdminProfileInTx(tx, {
        accountId,
        roleId: role.id,
        displayName,
      });
      await this.audit.recordInTx(tx, {
        adminId: actor.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.ADMIN_PROFILE_CREATE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.ADMIN_PROFILE,
        targetId: profileId,
        afterJson: {
          displayName,
          roleId: role.id,
          accountId,
          accountStatus,
          phone,
          email,
          attachedExistingAccount: Boolean(existingAccount),
        },
        sessionId: actor.sessionId,
      });
      return profileId;
    });

    const detail = await this.getAdmin(createdId);
    await this.permissions.invalidate(detail.accountId);
    if (detail.accountStatus !== 'ACTIVE') {
      await this.sessions.revokeAllSessionsForAccount(detail.accountId);
    }
    return detail;
  }

  /**
   * Canonical match: phone and email must not resolve to different Accounts.
   * Non-null stored fields must equal supplied identifiers; null fields are
   * left untouched (no silent identity fill).
   */
  private async resolveExistingAccountForCreate(input: {
    phone: string | null;
    email: string | null;
  }): Promise<{
    id: string;
    phone: string | null;
    email: string | null;
    status: string;
  } | null> {
    const byPhone = input.phone
      ? await this.repo.findAccountByPhone(input.phone)
      : null;
    const byEmail = input.email
      ? await this.repo.findAccountByEmail(input.email)
      : null;
    if (byPhone && byEmail && byPhone.id !== byEmail.id) {
      throw adminRbacInvalidInput(
        'phone and email match different existing Accounts',
      );
    }
    const account = byPhone ?? byEmail;
    if (!account) return null;
    if (input.phone && account.phone && account.phone !== input.phone) {
      throw adminRbacInvalidInput('Phone does not match existing Account');
    }
    if (input.email && account.email && account.email !== input.email) {
      throw adminRbacInvalidInput('Email does not match existing Account');
    }
    if (input.phone && !account.phone) {
      throw adminRbacInvalidInput(
        'Cannot attach phone to existing Account that has no phone; identity fields are immutable on attach',
      );
    }
    if (input.email && !account.email) {
      throw adminRbacInvalidInput(
        'Cannot attach email to existing Account that has no email; identity fields are immutable on attach',
      );
    }
    return account;
  }

  async updateAdmin(
    actor: CurrentAdminContext,
    adminId: string,
    input: {
      displayName?: string;
      roleId?: string;
      accountStatus?: string;
    },
  ): Promise<AdminProfileDetail> {
    const existing = await this.repo.getAdmin(adminId);
    if (!existing) throw adminRbacNotFound('Administrator not found');

    const patch: {
      displayName?: string;
      roleId?: string;
      accountStatus?: AdminAccountStatus;
    } = {};
    if (input.displayName !== undefined) {
      patch.displayName = normalizeDisplayName(input.displayName);
    }
    if (input.roleId !== undefined && input.roleId !== existing.roleId) {
      assertNotSelfAdmin(actor.adminProfileId, adminId, 'change role of');
      const role = await this.prisma
        .getDb()
        .orm.public.Role.where({ id: input.roleId })
        .first();
      if (!role) throw adminRbacNotFound('Role not found');
      if (!role.active) {
        throw adminRbacInvalidInput('Cannot assign an inactive role');
      }
      const roleCodes = await this.repo.permissionCodesForRole(role.id);
      assertAssignablePermissionCodes(actor.permissions, roleCodes);
      patch.roleId = role.id;
    }
    if (input.accountStatus !== undefined) {
      assertNotSelfAdmin(
        actor.adminProfileId,
        adminId,
        'change account status of',
      );
      patch.accountStatus = parseAccountStatus(input.accountStatus);
      // Restoring ACTIVE re-grants the target role's effective codes — same delegation.
      if (
        patch.accountStatus === 'ACTIVE' &&
        existing.accountStatus !== 'ACTIVE'
      ) {
        const restoreRoleId = patch.roleId ?? existing.roleId;
        const restoreCodes =
          await this.repo.permissionCodesForRole(restoreRoleId);
        assertAssignablePermissionCodes(actor.permissions, restoreCodes);
      }
    }

    if (
      patch.roleId === undefined &&
      patch.displayName === undefined &&
      patch.accountStatus === undefined
    ) {
      return existing;
    }

    await this.prisma.getDb().transaction(async (tx) => {
      const nextStatus =
        patch.accountStatus ??
        (existing.accountStatus as AdminAccountStatus);
      const nextRoleId = patch.roleId ?? existing.roleId;
      if (
        (patch.accountStatus &&
          patch.accountStatus !== existing.accountStatus) ||
        patch.roleId
      ) {
        await this.assertNotLastPrivilegeLossInTx(tx, {
          losingAccountId: existing.accountId,
          losingRoleId: existing.roleId,
          newAccountStatus: nextStatus,
          newRoleId: nextRoleId,
          privilegeCodes: [
            ADMIN_PERMISSIONS.ADMINS_MANAGE,
            ADMIN_PERMISSIONS.ROLES_MANAGE,
          ],
        });
      }
      if (patch.accountStatus && patch.accountStatus !== existing.accountStatus) {
        await this.repo.updateAccountStatusInTx(
          tx,
          existing.accountId,
          patch.accountStatus,
        );
        await this.audit.recordInTx(tx, {
          adminId: actor.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.ADMIN_PROFILE_ACCOUNT_STATUS,
          targetType: ADMIN_AUDIT_TARGET_TYPES.ADMIN_PROFILE,
          targetId: adminId,
          beforeJson: { accountStatus: existing.accountStatus },
          afterJson: {
            accountStatus: patch.accountStatus,
            note: 'Account.status is Account-wide (Admin/Customer/Merchant/Driver sessions for this Account)',
          },
          sessionId: actor.sessionId,
        });
      }
      if (patch.displayName !== undefined || patch.roleId !== undefined) {
        await this.repo.updateAdminProfileInTx(tx, adminId, {
          displayName: patch.displayName,
          roleId: patch.roleId,
        });
        await this.audit.recordInTx(tx, {
          adminId: actor.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.ADMIN_PROFILE_UPDATE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.ADMIN_PROFILE,
          targetId: adminId,
          beforeJson: {
            displayName: existing.displayName,
            roleId: existing.roleId,
          },
          afterJson: {
            displayName: patch.displayName ?? existing.displayName,
            roleId: patch.roleId ?? existing.roleId,
          },
          sessionId: actor.sessionId,
        });
      }
    });

    const detail = await this.getAdmin(adminId);
    await this.permissions.invalidate(detail.accountId);
    if (
      patch.roleId !== undefined ||
      (patch.accountStatus !== undefined && patch.accountStatus !== 'ACTIVE')
    ) {
      await this.sessions.revokeAllSessionsForAccount(detail.accountId);
    }
    return detail;
  }

  async createRole(
    actor: CurrentAdminContext,
    input: {
      name: string;
      description?: string | null;
      active?: boolean;
      permissionCodes: string[];
    },
  ): Promise<AdminRoleDetail> {
    const name = normalizeRoleName(input.name);
    const codes = uniquePermissionCodes(input.permissionCodes);
    if (await this.repo.findRoleByName(name)) {
      throw adminRbacDuplicate(`Role name already exists: ${name}`);
    }
    const { resolved, missing } =
      await this.repo.resolvePermissionIdsByCodes(codes);
    if (missing.length > 0) {
      throw adminRbacInvalidInput(
        `Unknown permissionCodes (not in catalogue): ${missing.join(', ')}`,
      );
    }
    assertAssignablePermissionCodes(actor.permissions, codes);

    const roleId = await this.prisma.getDb().transaction(async (tx) => {
      const id = await this.repo.createRoleInTx(tx, {
        name,
        description: input.description?.trim() || null,
        active: input.active !== false,
      });
      await this.repo.replaceRolePermissionsInTx(
        tx,
        id,
        resolved.map((r) => r.id),
      );
      await this.audit.recordInTx(tx, {
        adminId: actor.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.ADMIN_ROLE_CREATE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.ROLE,
        targetId: id,
        afterJson: { name, permissionCodes: codes, active: input.active !== false },
        sessionId: actor.sessionId,
      });
      return id;
    });
    return this.getRole(roleId);
  }

  async updateRole(
    actor: CurrentAdminContext,
    roleId: string,
    input: {
      name?: string;
      description?: string | null;
      active?: boolean;
      permissionCodes?: string[];
    },
  ): Promise<AdminRoleDetail> {
    const existing = await this.repo.getRole(roleId);
    if (!existing) throw adminRbacNotFound('Role not found');

    const nextName =
      input.name !== undefined ? normalizeRoleName(input.name) : existing.name;
    if (nextName !== existing.name) {
      const clash = await this.repo.findRoleByName(nextName);
      if (clash && clash.id !== roleId) {
        throw adminRbacDuplicate(`Role name already exists: ${nextName}`);
      }
    }

    let nextCodes = existing.permissionCodes;
    let permissionIds: string[] | null = null;
    if (input.permissionCodes !== undefined) {
      nextCodes = uniquePermissionCodes(input.permissionCodes);
      const { resolved, missing } =
        await this.repo.resolvePermissionIdsByCodes(nextCodes);
      if (missing.length > 0) {
        throw adminRbacInvalidInput(
          `Unknown permissionCodes (not in catalogue): ${missing.join(', ')}`,
        );
      }
      assertAssignablePermissionCodes(actor.permissions, nextCodes);
      permissionIds = resolved.map((r) => r.id);
    }

    const nextActive =
      input.active !== undefined ? input.active : existing.active;

    // Activating an inactive role restores its grant set — same delegation.
    if (!existing.active && nextActive) {
      assertAssignablePermissionCodes(actor.permissions, nextCodes);
    }

    await this.prisma.getDb().transaction(async (tx) => {
      await this.assertRoleMutationKeepsPrivilegeInTx(tx, {
        roleId,
        nextActive,
        nextCodes,
        privilegeCodes: [
          ADMIN_PERMISSIONS.ADMINS_MANAGE,
          ADMIN_PERMISSIONS.ROLES_MANAGE,
        ],
      });
      await this.repo.updateRoleInTx(tx, roleId, {
        name: input.name !== undefined ? nextName : undefined,
        description:
          input.description !== undefined
            ? input.description?.trim() || null
            : undefined,
        active: input.active,
      });
      if (permissionIds) {
        await this.repo.replaceRolePermissionsInTx(tx, roleId, permissionIds);
        await this.audit.recordInTx(tx, {
          adminId: actor.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.ADMIN_ROLE_PERMISSIONS_REPLACE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.ROLE,
          targetId: roleId,
          beforeJson: { permissionCodes: existing.permissionCodes },
          afterJson: { permissionCodes: nextCodes },
          sessionId: actor.sessionId,
        });
      }
      if (
        input.name !== undefined ||
        input.description !== undefined ||
        input.active !== undefined
      ) {
        await this.audit.recordInTx(tx, {
          adminId: actor.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.ADMIN_ROLE_UPDATE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.ROLE,
          targetId: roleId,
          beforeJson: {
            name: existing.name,
            description: existing.description,
            active: existing.active,
          },
          afterJson: {
            name: nextName,
            description:
              input.description !== undefined
                ? input.description?.trim() || null
                : existing.description,
            active: nextActive,
          },
          sessionId: actor.sessionId,
        });
      }
    });

    const accountIds = await this.repo.listAccountIdsForRole(roleId);
    for (const accountId of accountIds) {
      await this.permissions.invalidate(accountId);
    }
    const privilegeChanged =
      permissionIds !== null ||
      (input.active !== undefined && input.active !== existing.active);
    if (privilegeChanged) {
      for (const accountId of accountIds) {
        await this.sessions.revokeAllSessionsForAccount(accountId);
      }
    }
    return this.getRole(roleId);
  }

  private optionalPhone(raw?: string): string | null {
    if (raw === undefined || raw.trim() === '') return null;
    try {
      return normalizePhone(raw, DEFAULT_PHONE_COUNTRY);
    } catch (error) {
      if (error instanceof AuthError) {
        throw adminRbacInvalidInput(error.message);
      }
      throw error;
    }
  }

  private optionalEmail(raw?: string): string | null {
    if (raw === undefined || raw.trim() === '') return null;
    try {
      return normalizeEmail(raw);
    } catch (error) {
      if (error instanceof AuthError) {
        throw adminRbacInvalidInput(error.message);
      }
      throw error;
    }
  }

  private async assertNotLastPrivilegeLossInTx(
    tx: {
      orm: import('../../../infrastructure/database/database.module').SpeedyGoDb['orm'];
      query?: (plan: unknown) => unknown;
    },
    input: {
      losingAccountId: string;
      losingRoleId: string;
      newAccountStatus: AdminAccountStatus;
      newRoleId: string;
      privilegeCodes: readonly string[];
    },
  ): Promise<void> {
    // Acquire DB locks before any protected-state read; hold through caller TX.
    await this.repo.lockPrivilegesInTx(tx, input.privilegeCodes);

    const oldCodes = await this.repo.permissionCodesForRole(
      input.losingRoleId,
      tx,
    );
    const newCodes = await this.repo.permissionCodesForRole(
      input.newRoleId,
      tx,
    );
    const oldRole = await tx.orm.public.Role.where({
      id: input.losingRoleId,
    }).first();
    const newRole = await tx.orm.public.Role.where({
      id: input.newRoleId,
    }).first();
    const account = await tx.orm.public.Account.where({
      id: input.losingAccountId,
    }).first();

    for (const privilege of input.privilegeCodes) {
      const before = await this.repo.countActiveAdminsWithPermission(
        privilege,
        tx,
      );
      if (before === 0) continue;
      const currentlyCounts =
        account?.status === 'ACTIVE' &&
        oldRole?.active === true &&
        oldCodes.includes(privilege);
      const willCount =
        input.newAccountStatus === 'ACTIVE' &&
        newRole?.active === true &&
        newCodes.includes(privilege);
      if (currentlyCounts && !willCount && before <= 1) {
        throw adminRbacLastManagerProtected(
          `Cannot remove the last active administrator with ${privilege}`,
        );
      }
    }
  }

  private async assertRoleMutationKeepsPrivilegeInTx(
    tx: {
      orm: import('../../../infrastructure/database/database.module').SpeedyGoDb['orm'];
      query?: (plan: unknown) => unknown;
    },
    input: {
      roleId: string;
      nextActive: boolean;
      nextCodes: readonly string[];
      privilegeCodes: readonly string[];
    },
  ): Promise<void> {
    await this.repo.lockPrivilegesInTx(tx, input.privilegeCodes);

    // Re-read role + membership under the advisory locks (same TX client).
    const roleRow = await tx.orm.public.Role.where({ id: input.roleId }).first();
    if (!roleRow) return;
    const existingCodes = await this.repo.permissionCodesForRole(
      input.roleId,
      tx,
    );
    const members = await this.repo.listAccountIdsForRole(input.roleId, tx);
    let activeMembersOnRole = 0;
    for (const accountId of members) {
      const account = await tx.orm.public.Account.where({
        id: accountId,
      }).first();
      if (account?.status === 'ACTIVE') activeMembersOnRole += 1;
    }

    for (const privilege of input.privilegeCodes) {
      const before = await this.repo.countActiveAdminsWithPermission(
        privilege,
        tx,
      );
      if (before === 0) continue;
      const roleCurrentlyContributes =
        roleRow.active &&
        existingCodes.includes(privilege) &&
        activeMembersOnRole > 0;
      const roleWillContribute =
        input.nextActive &&
        input.nextCodes.includes(privilege) &&
        activeMembersOnRole > 0;
      if (roleCurrentlyContributes && !roleWillContribute) {
        const remaining =
          before - (roleCurrentlyContributes ? activeMembersOnRole : 0);
        if (remaining <= 0) {
          throw adminRbacLastManagerProtected(
            `Role change would leave zero active administrators with ${privilege}`,
          );
        }
      }
    }
  }
}
