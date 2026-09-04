import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { PermissionService } from '../../authorization/permission.service';
import {
  adminProfileRequired,
  adminRoleInactive,
} from '../domain/admin.errors';
import type { CurrentAdminContext } from '../domain/admin.types';

@Injectable()
export class AdminProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  async resolveCurrentAdmin(
    accountId: string,
    sessionId: string,
  ): Promise<CurrentAdminContext> {
    const db = this.prisma.getDb().orm.public;
    const profile = await db.AdminProfile.where({ accountId }).first();
    if (!profile) {
      throw adminProfileRequired();
    }
    const role = await db.Role.where({ id: profile.roleId }).first();
    if (!role) {
      throw adminProfileRequired('Admin role is missing');
    }
    if (!role.active) {
      throw adminRoleInactive();
    }
    const permissions = await this.permissions.codesForAccount(accountId);
    return {
      adminProfileId: profile.id,
      accountId,
      sessionId,
      displayName: profile.displayName,
      roleId: role.id,
      roleName: role.name,
      permissions,
    };
  }
}
