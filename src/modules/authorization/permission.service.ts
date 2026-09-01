import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { PrismaService } from '../../infrastructure/database/database.module';

@Injectable()
export class PermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async codesForAccount(accountId: string): Promise<string[]> {
    const ttl = this.config.get<number>('auth.permissionCacheTtlSeconds', 15);
    const prefix = this.config.get<string>('auth.redisKeyPrefix', 'auth:');
    const key = `${prefix}perm:${accountId}`;
    const cached = await this.redis.getClient().get(key);
    if (cached) {
      return JSON.parse(cached) as string[];
    }

    const db = this.prisma.getDb().orm.public;
    const admin = await db.AdminProfile.where({ accountId }).first();
    if (!admin) {
      return [];
    }
    const role = await db.Role.where({ id: admin.roleId }).first();
    if (!role || !role.active) {
      return [];
    }
    const links = await db.RolePermission.where({
      roleId: role.id,
    }).all();
    const codes: string[] = [];
    for (const link of links) {
      const permission = await db.Permission.where({
        id: link.permissionId,
      }).first();
      if (permission) {
        codes.push(permission.code);
      }
    }
    await this.redis.getClient().set(key, JSON.stringify(codes), 'EX', ttl);
    return codes;
  }

  async invalidate(accountId: string): Promise<void> {
    const prefix = this.config.get<string>('auth.redisKeyPrefix', 'auth:');
    await this.redis.getClient().del(`${prefix}perm:${accountId}`);
  }
}
