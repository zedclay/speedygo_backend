/**
 * Database integration: concurrent last-`admins.manage` removal cannot leave
 * zero eligible managers. Uses `pg_advisory_xact_lock` via AdminRbacRepository
 * (actual implementation) on independent transactions against disposable
 * `speedygo_test` — no Redis / no HTTP E2E.
 *
 * Config: test/jest-isolated-db.json
 * Refuse: any DATABASE_URL other than 127.0.0.1|localhost:5433/speedygo_test
 */
import { randomBytes } from 'node:crypto';
import {
  closeDb,
  getDb,
  resetDbClient,
  type SpeedyGoDb,
} from '../../../../prisma/db';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import { ADMIN_PERMISSIONS } from '../domain/admin-permissions';
import { AdminRbacError } from '../domain/admin-rbac.errors';
import { AdminRbacRepository } from './admin-rbac.repository';

function assertIsolatedTestDb(): void {
  const raw = process.env['DATABASE_URL'];
  if (!raw) throw new Error('refused: DATABASE_URL is not set');
  const url = new URL(raw);
  const host = url.hostname;
  if (
    url.pathname !== '/speedygo_test' ||
    url.port !== '5433' ||
    (host !== '127.0.0.1' && host !== 'localhost')
  ) {
    throw new Error(
      'refused: target is not speedygo_test on 127.0.0.1:5433 (no operational DB)',
    );
  }
}

assertIsolatedTestDb();

const MANAGE = ADMIN_PERMISSIONS.ADMINS_MANAGE;
const NS = '01a1b10c-1000-7000-8000-';
const ids = {
  perm: NS + '00000000a001',
  role: NS + '00000000b001',
  acct1: NS + '00000000c001',
  acct2: NS + '00000000c002',
  adm1: NS + '00000000d001',
  adm2: NS + '00000000d002',
};

describe('Admin RBAC last-manager lockout (db integration)', () => {
  jest.setTimeout(60_000);

  let prisma: PrismaService;
  let repo: AdminRbacRepository;

  beforeAll(async () => {
    resetDbClient();
    prisma = new PrismaService();
    repo = new AdminRbacRepository(prisma);
    const db = getDb();
    await cleanup(db);
    await seed(db);
  });

  afterAll(async () => {
    try {
      await cleanup(getDb());
    } finally {
      await closeDb();
    }
  });

  it('serializes concurrent suspensions so at least one admins.manage holder remains', async () => {
    const db = getDb();

    const runSuspend = async (accountId: string) => {
      try {
        await db.transaction(async (tx) => {
          await repo.lockPrivilegesInTx(tx, [MANAGE]);
          const before = await repo.countActiveAdminsWithPermission(MANAGE, tx);
          if (before <= 1) {
            throw new AdminRbacError(
              'ADMIN_RBAC_LAST_MANAGER_PROTECTED',
              `Cannot remove the last active administrator with ${MANAGE}`,
              409,
            );
          }
          await repo.updateAccountStatusInTx(tx, accountId, 'SUSPENDED');
        });
        return { ok: true as const };
      } catch (e) {
        const code =
          e instanceof AdminRbacError
            ? e.code
            : e instanceof Error
              ? e.message
              : String(e);
        return { ok: false as const, code };
      }
    };

    const [a, b] = await Promise.all([
      runSuspend(ids.acct1),
      runSuspend(ids.acct2),
    ]);

    const remaining = await repo.countActiveAdminsWithPermission(MANAGE);
    expect(remaining).toBeGreaterThanOrEqual(1);
    expect(remaining).toBeLessThanOrEqual(2);

    const successes = [a, b].filter((r) => r.ok).length;
    const blocked = [a, b].filter(
      (r) => !r.ok && String(r.code).includes('LAST_MANAGER'),
    ).length;
    // Under advisory lock: exactly one suspend commits; the other is protected.
    expect(successes).toBe(1);
    expect(blocked).toBe(1);
    expect(remaining).toBe(1);
  });
});

async function seed(db: SpeedyGoDb): Promise<void> {
  const orm = db.orm.public;
  const now = pgNow();
  let permId = ids.perm;
  const existingPerm = await orm.Permission.where({
    code: pgVarchar<128>(MANAGE),
  }).first();
  if (existingPerm) {
    permId = existingPerm.id;
  } else {
    await orm.Permission.create({
      id: ids.perm,
      code: pgVarchar<128>(MANAGE),
      description: 'db-spec admins.manage',
    });
  }
  await orm.Role.create({
    id: ids.role,
    name: pgVarchar<128>(
      `aw-db-spec-lockout-${randomBytes(3).toString('hex')}`,
    ),
    description: 'db-spec concurrent lockout',
    active: true,
  });
  await orm.RolePermission.create({
    roleId: ids.role,
    permissionId: permId,
  });
  for (const [acct, adm, phone] of [
    [ids.acct1, ids.adm1, '+213550019001'],
    [ids.acct2, ids.adm2, '+213550019002'],
  ] as const) {
    await orm.Account.create({
      id: acct,
      phone: pgVarchar<32>(phone),
      email: null,
      status: pgVarchar<64>('ACTIVE'),
      createdAt: now,
      updatedAt: now,
    });
    await orm.AdminProfile.create({
      id: adm,
      accountId: acct,
      roleId: ids.role,
      displayName: pgVarchar<255>(`db-spec ${phone}`),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function cleanup(db: SpeedyGoDb): Promise<void> {
  const orm = db.orm.public;
  for (const id of [ids.adm1, ids.adm2]) {
    try {
      await orm.AdminProfile.where({ id }).delete();
    } catch {
      /* absent */
    }
  }
  for (const id of [ids.acct1, ids.acct2]) {
    try {
      await orm.Account.where({ id }).delete();
    } catch {
      /* absent */
    }
  }
  try {
    await orm.RolePermission.where({ roleId: ids.role }).deleteAndCount();
  } catch {
    /* absent */
  }
  try {
    await orm.Role.where({ id: ids.role }).delete();
  } catch {
    /* absent */
  }
  // Do not delete shared catalogue Permission.admins.manage if it pre-existed.
  try {
    const owned = await orm.Permission.where({ id: ids.perm }).first();
    if (owned) {
      await orm.Permission.where({ id: ids.perm }).delete();
    }
  } catch {
    /* absent */
  }
}
