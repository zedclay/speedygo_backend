import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import { normalizeListQuery } from '../domain/admin.policy';
import { ADMIN_PERMISSIONS } from '../domain/admin-permissions';
import {
  ADMIN_RBAC_ADVISORY_LOCK_CLASS,
  adminRbacPrivilegeLockObjectId,
} from '../domain/admin-rbac.lock';
import type {
  AdminPermissionCatalogItem,
  AdminProfileDetail,
  AdminProfileListItem,
  AdminProfileListQuery,
  AdminRoleDetail,
  AdminRoleListItem,
  AdminRoleListQuery,
  AdminAccountStatus,
} from '../domain/admin-rbac.types';
import type { AdminPaginatedResult } from '../domain/admin.types';

type OrmClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

async function consumeQueryRows(result: unknown): Promise<void> {
  if (Array.isArray(result)) return;
  if (result != null && typeof (result as Promise<unknown>).then === 'function') {
    await (result as Promise<unknown>);
    return;
  }
  if (
    result &&
    typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
      'function'
  ) {
    for await (const _ of result as AsyncIterable<unknown>) {
      /* drain */
    }
  }
}

function orm(client: { orm: SpeedyGoDb['orm'] }) {
  return client.orm.public;
}

@Injectable()
export class AdminRbacRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async listAdmins(
    query: Partial<AdminProfileListQuery> & {
      limit?: number;
      offset?: number;
    },
  ): Promise<AdminPaginatedResult<AdminProfileListItem>> {
    const { limit, offset } = normalizeListQuery(query);
    const db = this.db();
    const profiles = await orm(db).AdminProfile.all();
    const accounts = await orm(db).Account.all();
    const roles = await orm(db).Role.all();
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const roleById = new Map(roles.map((r) => [r.id, r]));

    let rows: AdminProfileListItem[] = [];
    for (const p of profiles) {
      const account = accountById.get(p.accountId);
      const role = roleById.get(p.roleId);
      if (!account || !role) continue;
      const item: AdminProfileListItem = {
        id: p.id,
        displayName: p.displayName,
        twoFactorEnabled: p.twoFactorEnabled,
        roleId: role.id,
        roleName: role.name,
        roleActive: role.active,
        accountId: account.id,
        phone: account.phone,
        email: account.email,
        accountStatus: account.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
      if (query.roleId && item.roleId !== query.roleId) continue;
      if (query.accountStatus && item.accountStatus !== query.accountStatus) {
        continue;
      }
      if (query.q) {
        const q = query.q.trim().toLowerCase();
        const hay = [
          item.displayName,
          item.phone ?? '',
          item.email ?? '',
          item.roleName,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) continue;
      }
      rows.push(item);
    }
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const total = rows.length;
    rows = rows.slice(offset, offset + limit);
    return { items: rows, total, limit, offset };
  }

  async getAdmin(id: string): Promise<AdminProfileDetail | null> {
    const db = this.db();
    const profile = await orm(db).AdminProfile.where({ id }).first();
    if (!profile) return null;
    const account = await orm(db).Account.where({ id: profile.accountId }).first();
    const role = await orm(db).Role.where({ id: profile.roleId }).first();
    if (!account || !role) return null;
    const permissionCodes = await this.permissionCodesForRole(role.id, db);
    return {
      id: profile.id,
      displayName: profile.displayName,
      twoFactorEnabled: profile.twoFactorEnabled,
      roleId: role.id,
      roleName: role.name,
      roleActive: role.active,
      accountId: account.id,
      phone: account.phone,
      email: account.email,
      accountStatus: account.status,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      permissionCodes,
    };
  }

  async listRoles(
    query: Partial<AdminRoleListQuery> & {
      limit?: number;
      offset?: number;
    },
  ): Promise<AdminPaginatedResult<AdminRoleListItem>> {
    const { limit, offset } = normalizeListQuery(query);
    const db = this.db();
    const roles = await orm(db).Role.all();
    const profiles = await orm(db).AdminProfile.all();
    const links = await orm(db).RolePermission.all();
    const memberCount = new Map<string, number>();
    for (const p of profiles) {
      memberCount.set(p.roleId, (memberCount.get(p.roleId) ?? 0) + 1);
    }
    const permCount = new Map<string, number>();
    for (const link of links) {
      permCount.set(link.roleId, (permCount.get(link.roleId) ?? 0) + 1);
    }
    let rows: AdminRoleListItem[] = roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      active: r.active,
      memberCount: memberCount.get(r.id) ?? 0,
      permissionCount: permCount.get(r.id) ?? 0,
    }));
    if (query.active !== undefined) {
      rows = rows.filter((r) => r.active === query.active);
    }
    if (query.q) {
      const q = query.q.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.description ?? '').toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    const total = rows.length;
    return {
      items: rows.slice(offset, offset + limit),
      total,
      limit,
      offset,
    };
  }

  async getRole(id: string): Promise<AdminRoleDetail | null> {
    const db = this.db();
    const role = await orm(db).Role.where({ id }).first();
    if (!role) return null;
    const memberCount = (
      await orm(db).AdminProfile.where({ roleId: id }).all()
    ).length;
    const permissionCodes = await this.permissionCodesForRole(id, db);
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      active: role.active,
      memberCount,
      permissionCodes,
    };
  }

  async listPermissionCatalog(): Promise<AdminPermissionCatalogItem[]> {
    const rows = await orm(this.db()).Permission.all();
    return rows
      .map((p) => ({
        id: p.id,
        code: p.code,
        description: p.description,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async permissionCodesForRole(
    roleId: string,
    client: { orm: SpeedyGoDb['orm'] } = this.db(),
  ): Promise<string[]> {
    const links = await orm(client).RolePermission.where({ roleId }).all();
    const codes: string[] = [];
    for (const link of links) {
      const permission = await orm(client)
        .Permission.where({ id: link.permissionId })
        .first();
      if (permission) codes.push(permission.code);
    }
    codes.sort();
    return codes;
  }

  async findAccountByPhone(
    phone: string,
  ): Promise<{
    id: string;
    phone: string | null;
    email: string | null;
    status: string;
  } | null> {
    const row = await orm(this.db())
      .Account.where({ phone: pgVarchar<32>(phone) })
      .first();
    return row
      ? {
          id: row.id,
          phone: row.phone,
          email: row.email,
          status: row.status,
        }
      : null;
  }

  async findAccountByEmail(
    email: string,
  ): Promise<{
    id: string;
    phone: string | null;
    email: string | null;
    status: string;
  } | null> {
    const row = await orm(this.db())
      .Account.where({ email: pgVarchar<255>(email) })
      .first();
    return row
      ? {
          id: row.id,
          phone: row.phone,
          email: row.email,
          status: row.status,
        }
      : null;
  }

  async findAdminProfileByAccountId(accountId: string) {
    return orm(this.db()).AdminProfile.where({ accountId }).first();
  }

  async findRoleByName(name: string) {
    return orm(this.db()).Role.where({ name: pgVarchar<128>(name) }).first();
  }

  async resolvePermissionIdsByCodes(
    codes: readonly string[],
    client: { orm: SpeedyGoDb['orm'] } = this.db(),
  ): Promise<{
    resolved: { id: string; code: string }[];
    missing: string[];
  }> {
    const resolved: { id: string; code: string }[] = [];
    const missing: string[] = [];
    for (const code of codes) {
      const row = await orm(client)
        .Permission.where({ code: pgVarchar<128>(code) })
        .first();
      if (!row) {
        missing.push(code);
      } else {
        resolved.push({ id: row.id, code: row.code });
      }
    }
    return { resolved, missing };
  }

  /**
   * Count AdminProfiles that can currently exercise `permissionCode`
   * (Account ACTIVE + Role.active + RolePermission includes code).
   */
  async countActiveAdminsWithPermission(
    permissionCode: string,
    client: { orm: SpeedyGoDb['orm'] } = this.db(),
  ): Promise<number> {
    const permission = await orm(client)
      .Permission.where({
        code: pgVarchar<128>(permissionCode),
      })
      .first();
    if (!permission) return 0;
    const links = await orm(client)
      .RolePermission.where({ permissionId: permission.id })
      .all();
    const roleIds = new Set<string>();
    for (const link of links) {
      const role = await orm(client).Role.where({ id: link.roleId }).first();
      if (role?.active) roleIds.add(role.id);
    }
    let count = 0;
    for (const roleId of roleIds) {
      const profiles = await orm(client).AdminProfile.where({ roleId }).all();
      for (const profile of profiles) {
        const account = await orm(client)
          .Account.where({ id: profile.accountId })
          .first();
        if (account?.status === 'ACTIVE') count += 1;
      }
    }
    return count;
  }

  async countActiveAdminsWithManage(
    client: { orm: SpeedyGoDb['orm'] } = this.db(),
  ): Promise<number> {
    return this.countActiveAdminsWithPermission(
      ADMIN_PERMISSIONS.ADMINS_MANAGE,
      client,
    );
  }

  /**
   * Database-coordinated lock for last-manager invariants.
   *
   * Primitive: `pg_advisory_xact_lock(classId, objectId)` (PostgreSQL).
   * Scope: transaction — held until COMMIT/ROLLBACK of `client`.
   * Object: SHA-256-derived int32 of privilege code (`admin-rbac.lock.ts`).
   * Class: `ADMIN_RBAC_ADVISORY_LOCK_CLASS` (0x53474152 / 'SGAR').
   *
   * Must be acquired **before** counting holders / reading protected state for
   * Account.status, role assignment, Role.active, and permission replacement.
   */
  async lockPrivilegeInTx(
    client: OrmClient,
    privilegeCode: string,
  ): Promise<void> {
    if (typeof client.query !== 'function') {
      throw new Error(
        'Admin RBAC privilege lock requires a transactional client with query()',
      );
    }
    const objectId = adminRbacPrivilegeLockObjectId(privilegeCode);
    const plan = this.db()
      .raw.sql`
        SELECT 1::int4 AS locked
        WHERE (
          SELECT CASE
            WHEN pg_advisory_xact_lock(${ADMIN_RBAC_ADVISORY_LOCK_CLASS}, ${objectId}) IS NULL
              THEN 1
            ELSE 1
          END
        ) = 1
      `
      .returnsRow({
        locked: 'pg/int4@1',
      })
      .build();
    await consumeQueryRows(client.query(plan));
  }

  /** Lock every privilege code that participates in last-holder protection. */
  async lockPrivilegesInTx(
    client: OrmClient,
    privilegeCodes: readonly string[],
  ): Promise<void> {
    const sorted = [...new Set(privilegeCodes)].sort();
    for (const code of sorted) {
      await this.lockPrivilegeInTx(client, code);
    }
  }

  async createAccountInTx(
    tx: { orm: SpeedyGoDb['orm'] },
    input: {
      phone: string | null;
      email: string | null;
      status: AdminAccountStatus;
    },
  ): Promise<string> {
    const now = pgNow();
    const row = await orm(tx).Account.create({
      id: createUuidV7(),
      phone: input.phone ? pgVarchar<32>(input.phone) : null,
      email: input.email ? pgVarchar<255>(input.email) : null,
      status: pgVarchar<64>(input.status),
      createdAt: now,
      updatedAt: now,
    });
    return row.id;
  }

  async createAdminProfileInTx(
    tx: { orm: SpeedyGoDb['orm'] },
    input: {
      accountId: string;
      roleId: string;
      displayName: string;
    },
  ): Promise<string> {
    const now = pgNow();
    const row = await orm(tx).AdminProfile.create({
      id: createUuidV7(),
      accountId: input.accountId,
      roleId: input.roleId,
      displayName: pgVarchar<255>(input.displayName),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    return row.id;
  }

  async updateAdminProfileInTx(
    tx: { orm: SpeedyGoDb['orm'] },
    id: string,
    patch: { displayName?: string; roleId?: string },
  ): Promise<void> {
    const data: Record<string, unknown> = { updatedAt: pgNow() };
    if (patch.displayName !== undefined) {
      data.displayName = pgVarchar<255>(patch.displayName);
    }
    if (patch.roleId !== undefined) {
      data.roleId = patch.roleId;
    }
    await orm(tx).AdminProfile.where({ id }).update(data);
  }

  async updateAccountStatusInTx(
    tx: { orm: SpeedyGoDb['orm'] },
    accountId: string,
    status: AdminAccountStatus,
  ): Promise<void> {
    await orm(tx)
      .Account.where({ id: accountId })
      .update({
        status: pgVarchar<64>(status),
        updatedAt: pgNow(),
      });
  }

  async createRoleInTx(
    tx: { orm: SpeedyGoDb['orm'] },
    input: {
      name: string;
      description: string | null;
      active: boolean;
    },
  ): Promise<string> {
    const row = await orm(tx).Role.create({
      id: createUuidV7(),
      name: pgVarchar<128>(input.name),
      description: input.description,
      active: input.active,
    });
    return row.id;
  }

  async updateRoleInTx(
    tx: { orm: SpeedyGoDb['orm'] },
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      active?: boolean;
    },
  ): Promise<void> {
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = pgVarchar<128>(patch.name);
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.active !== undefined) data.active = patch.active;
    if (Object.keys(data).length === 0) return;
    await orm(tx).Role.where({ id }).update(data);
  }

  async replaceRolePermissionsInTx(
    tx: { orm: SpeedyGoDb['orm'] },
    roleId: string,
    permissionIds: readonly string[],
  ): Promise<void> {
    // Prisma 8 / Orchid: `.delete()` removes one row; use deleteAndCount for full clear.
    await orm(tx).RolePermission.where({ roleId }).deleteAndCount();
    for (const permissionId of permissionIds) {
      await orm(tx).RolePermission.create({ roleId, permissionId });
    }
  }

  async listAccountIdsForRole(
    roleId: string,
    client: { orm: SpeedyGoDb['orm'] } = this.db(),
  ): Promise<string[]> {
    const profiles = await orm(client).AdminProfile.where({ roleId }).all();
    return profiles.map((p) => p.accountId);
  }
}
