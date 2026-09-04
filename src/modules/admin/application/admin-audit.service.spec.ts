import { AdminAuditService } from './admin-audit.service';
import { ADMIN_ERROR_CODES } from '../domain/admin.errors';

describe('AdminAuditService', () => {
  it('record inserts AuditLog and returns the row', async () => {
    const created: Record<string, unknown>[] = [];
    const row = {
      id: 'aud1',
      adminId: 'admin1',
      action: 'merchant.verification.approve',
      targetType: 'Merchant',
      targetId: 'm1',
      beforeJson: null,
      afterJson: { status: 'ACTIVE' },
      ipAddress: null,
      sessionId: 's1',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const prisma = {
      getDb: () => ({
        orm: {
          public: {
            AuditLog: {
              create: (data: Record<string, unknown>) => {
                created.push(data);
                return Promise.resolve(data);
              },
              where: () => ({
                first: () => Promise.resolve(row),
                all: () => Promise.resolve([row]),
              }),
            },
          },
        },
      }),
    };
    const service = new AdminAuditService(prisma as never);
    const result = await service.record({
      adminId: 'admin1',
      action: 'merchant.verification.approve',
      targetType: 'Merchant',
      targetId: 'm1',
      afterJson: { status: 'ACTIVE' },
      sessionId: 's1',
    });
    expect(created).toHaveLength(1);
    expect(result.adminId).toBe('admin1');
    expect(result.action).toBe('merchant.verification.approve');
  });

  it('record throws ADMIN_AUDIT_FAILED when insert fails', async () => {
    const prisma = {
      getDb: () => ({
        orm: {
          public: {
            AuditLog: {
              create: () => Promise.reject(new Error('db down')),
            },
          },
        },
      }),
    };
    const service = new AdminAuditService(prisma as never);
    await expect(
      service.record({
        adminId: 'admin1',
        action: 'merchant.suspend',
        targetType: 'Merchant',
        targetId: 'm1',
      }),
    ).rejects.toMatchObject({
      code: ADMIN_ERROR_CODES.ADMIN_AUDIT_FAILED,
      httpStatus: 500,
    });
  });

  it('listAudits filters allowlisted fields and paginates', async () => {
    const rows = [
      {
        id: 'a2',
        adminId: 'admin1',
        action: 'merchant.suspend',
        targetType: 'Merchant',
        targetId: 'm2',
        beforeJson: null,
        afterJson: null,
        ipAddress: null,
        sessionId: null,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'a1',
        adminId: 'admin2',
        action: 'refund.create',
        targetType: 'Refund',
        targetId: 'r1',
        beforeJson: null,
        afterJson: null,
        ipAddress: null,
        sessionId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const prisma = {
      getDb: () => ({
        orm: {
          public: {
            AuditLog: {
              where: (filter: { adminId?: string }) => {
                const filtered = rows.filter((row) =>
                  filter.adminId ? row.adminId === filter.adminId : true,
                );
                const chain = {
                  aggregate: () => Promise.resolve({ total: filtered.length }),
                  orderBy: () => chain,
                  offset: () => chain,
                  limit: () => chain,
                  all: () => Promise.resolve(filtered),
                };
                return chain;
              },
            },
          },
        },
      }),
    };
    const service = new AdminAuditService(prisma as never);
    const result = await service.listAudits({
      adminId: 'admin1',
      limit: 10,
      offset: 0,
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe('a2');
  });
});
