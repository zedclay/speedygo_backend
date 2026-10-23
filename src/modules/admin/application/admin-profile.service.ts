import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import { PermissionService } from '../../authorization/permission.service';
import { normalizeAdminTemplateLocale } from '../../notifications/domain/admin-notification-template.policy';
import {
  adminInvalidInput,
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
      preferredLocale: normalizeAdminTemplateLocale(profile.preferredLocale),
    };
  }

  async updatePreferredLocale(
    admin: CurrentAdminContext,
    raw: string,
  ): Promise<CurrentAdminContext> {
    if (raw !== 'fr' && raw !== 'ar') {
      throw adminInvalidInput('preferredLocale must be fr or ar');
    }
    const db = this.prisma.getDb().orm.public;
    await db.AdminProfile.where({ id: admin.adminProfileId }).update({
      preferredLocale: pgVarchar<8>(raw),
      updatedAt: pgNow(),
    });
    return {
      ...admin,
      preferredLocale: raw,
    };
  }
}
