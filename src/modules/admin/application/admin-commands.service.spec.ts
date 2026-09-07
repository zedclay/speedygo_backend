import { AdminMerchantCommandsService } from './admin-merchant-commands.service';
import { AdminDriverCommandsService } from './admin-driver-commands.service';
import { AdminRefundCommandsService } from './admin-refund-commands.service';
import { ADMIN_ERROR_CODES } from '../domain/admin.errors';
import type { CurrentAdminContext } from '../domain/admin.types';

const admin: CurrentAdminContext = {
  adminProfileId: 'admin-real',
  accountId: 'acct',
  sessionId: 'sess',
  displayName: 'Ops',
  roleId: 'role',
  roleName: 'ops',
  permissions: ['merchants.verify', 'refunds.manage', 'drivers.verify'],
};

function mockPrisma(tx: unknown = {}) {
  return {
    getDb: () => ({
      transaction: jest.fn(async (fn: (client: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    }),
  };
}

function merchantsStub() {
  return {
    listMemberAccountIds: jest.fn().mockResolvedValue([]),
  };
}

function sessionsStub() {
  return {
    revokeAllSessionsForAccountInTx: jest.fn().mockResolvedValue([]),
    finalizeSessionRevocations: jest.fn().mockResolvedValue(undefined),
  };
}

function trackingStub() {
  return {
    disconnectSessions: jest.fn().mockReturnValue(0),
  };
}

function driversStub() {
  return {
    findProfileById: jest.fn().mockResolvedValue({
      id: 'd1',
      accountId: 'driver-acct',
    }),
  };
}

describe('Admin command actor spoof protection', () => {
  it('merchant approve uses CurrentAdmin.adminProfileId only', async () => {
    const merchantReview = {
      approveInTx: jest.fn().mockResolvedValue({ id: 'm1', status: 'ACTIVE' }),
    };
    const audit = { recordInTx: jest.fn().mockResolvedValue({}) };
    const prisma = mockPrisma();
    const service = new AdminMerchantCommandsService(
      prisma as never,
      merchantReview as never,
      merchantsStub() as never,
      sessionsStub() as never,
      trackingStub() as never,
      audit as never,
    );
    await service.approveVerification(admin, 'm1');
    expect(merchantReview.approveInTx).toHaveBeenCalledWith(expect.anything(), {
      merchantId: 'm1',
      adminId: 'admin-real',
    });
    expect(audit.recordInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ adminId: 'admin-real' }),
    );
  });

  it('rolls back when merchant audit write fails inside the same TX', async () => {
    const merchantReview = {
      approveInTx: jest.fn().mockResolvedValue({ id: 'm1', status: 'ACTIVE' }),
    };
    const audit = {
      recordInTx: jest.fn().mockRejectedValue({
        code: ADMIN_ERROR_CODES.ADMIN_AUDIT_FAILED,
        httpStatus: 500,
      }),
    };
    const prisma = mockPrisma();
    const service = new AdminMerchantCommandsService(
      prisma as never,
      merchantReview as never,
      merchantsStub() as never,
      sessionsStub() as never,
      trackingStub() as never,
      audit as never,
    );
    await expect(
      service.approveVerification(admin, 'm1'),
    ).rejects.toMatchObject({
      code: ADMIN_ERROR_CODES.ADMIN_AUDIT_FAILED,
    });
    expect(merchantReview.approveInTx).toHaveBeenCalled();
    expect(audit.recordInTx).toHaveBeenCalled();
  });

  it('merchant approve success path calls both InTx methods in one TX', async () => {
    const tx = { orm: {} };
    const merchantReview = {
      approveInTx: jest.fn().mockResolvedValue({ id: 'm1', status: 'ACTIVE' }),
    };
    const audit = { recordInTx: jest.fn().mockResolvedValue({}) };
    const transaction = jest.fn(
      async (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    );
    const prisma = {
      getDb: () => ({ transaction }),
    };
    const service = new AdminMerchantCommandsService(
      prisma as never,
      merchantReview as never,
      merchantsStub() as never,
      sessionsStub() as never,
      trackingStub() as never,
      audit as never,
    );
    const result = await service.approveVerification(admin, 'm1');
    expect(result).toEqual({ id: 'm1', status: 'ACTIVE' });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(merchantReview.approveInTx).toHaveBeenCalledWith(tx, {
      merchantId: 'm1',
      adminId: 'admin-real',
    });
    expect(audit.recordInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        adminId: 'admin-real',
        targetId: 'm1',
      }),
    );
  });

  it('merchant suspend revokes member sessions and disconnects sockets after commit', async () => {
    const merchantReview = {
      suspendInTx: jest.fn().mockResolvedValue({
        id: 'm1',
        status: 'SUSPENDED',
        alreadySuspended: false,
      }),
    };
    const merchants = {
      listMemberAccountIds: jest.fn().mockResolvedValue(['a1', 'a2']),
    };
    const sessions = {
      revokeAllSessionsForAccountInTx: jest
        .fn()
        .mockResolvedValueOnce(['s1'])
        .mockResolvedValueOnce(['s2', 's3']),
      finalizeSessionRevocations: jest.fn().mockResolvedValue(undefined),
    };
    const tracking = { disconnectSessions: jest.fn().mockReturnValue(2) };
    const audit = { recordInTx: jest.fn().mockResolvedValue({}) };
    const service = new AdminMerchantCommandsService(
      mockPrisma() as never,
      merchantReview as never,
      merchants as never,
      sessions as never,
      tracking as never,
      audit as never,
    );
    const result = await service.suspend(admin, 'm1');
    expect(result).toEqual({ id: 'm1', status: 'SUSPENDED' });
    expect(sessions.revokeAllSessionsForAccountInTx).toHaveBeenCalledTimes(2);
    expect(sessions.finalizeSessionRevocations).toHaveBeenCalledWith(
      ['a1', 'a2'],
      ['s1', 's2', 's3'],
    );
    expect(tracking.disconnectSessions).toHaveBeenCalledWith([
      's1',
      's2',
      's3',
    ]);
    expect(audit.recordInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adminId: 'admin-real',
        targetId: 'm1',
      }),
    );
    const auditCalls = audit.recordInTx.mock.calls as unknown as Array<
      [
        unknown,
        {
          afterJson: {
            sessionsRevoked: number;
            affectedAccountCount: number;
          };
        },
      ]
    >;
    expect(auditCalls[0][1].afterJson.sessionsRevoked).toBe(3);
    expect(auditCalls[0][1].afterJson.affectedAccountCount).toBe(2);
  });

  it('driver approve does not accept body adminId', async () => {
    const driverReview = {
      approveInTx: jest.fn().mockResolvedValue({
        id: 'd1',
        verificationStatus: 'APPROVED',
      }),
    };
    const audit = { recordInTx: jest.fn().mockResolvedValue({}) };
    const prisma = mockPrisma();
    const service = new AdminDriverCommandsService(
      prisma as never,
      driverReview as never,
      driversStub() as never,
      sessionsStub() as never,
      trackingStub() as never,
      audit as never,
    );
    await service.approveVerification(admin, 'd1');
    expect(driverReview.approveInTx).toHaveBeenCalledWith(
      expect.anything(),
      'd1',
    );
    expect(audit.recordInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ adminId: 'admin-real' }),
    );
  });

  it('driver suspend revokes the Driver Account sessions', async () => {
    const driverReview = {
      suspendInTx: jest.fn().mockResolvedValue({
        id: 'd1',
        verificationStatus: 'SUSPENDED',
        alreadySuspended: false,
      }),
    };
    const drivers = {
      findProfileById: jest.fn().mockResolvedValue({
        id: 'd1',
        accountId: 'driver-acct',
      }),
    };
    const sessions = {
      revokeAllSessionsForAccountInTx: jest.fn().mockResolvedValue(['s9']),
      finalizeSessionRevocations: jest.fn().mockResolvedValue(undefined),
    };
    const tracking = { disconnectSessions: jest.fn().mockReturnValue(1) };
    const audit = { recordInTx: jest.fn().mockResolvedValue({}) };
    const service = new AdminDriverCommandsService(
      mockPrisma() as never,
      driverReview as never,
      drivers as never,
      sessions as never,
      tracking as never,
      audit as never,
    );
    await service.suspend(admin, 'd1');
    expect(sessions.revokeAllSessionsForAccountInTx).toHaveBeenCalledWith(
      expect.anything(),
      'driver-acct',
    );
    expect(sessions.finalizeSessionRevocations).toHaveBeenCalledWith(
      ['driver-acct'],
      ['s9'],
    );
    expect(tracking.disconnectSessions).toHaveBeenCalledWith(['s9']);
  });

  it('rolls back merchant suspend side effects when audit fails (no Redis/socket finalize)', async () => {
    const merchantReview = {
      suspendInTx: jest.fn().mockResolvedValue({
        id: 'm1',
        status: 'SUSPENDED',
        alreadySuspended: false,
      }),
    };
    const merchants = {
      listMemberAccountIds: jest.fn().mockResolvedValue(['a1']),
    };
    const sessions = {
      revokeAllSessionsForAccountInTx: jest.fn().mockResolvedValue(['s1']),
      finalizeSessionRevocations: jest.fn().mockResolvedValue(undefined),
    };
    const tracking = { disconnectSessions: jest.fn().mockReturnValue(1) };
    const audit = {
      recordInTx: jest.fn().mockRejectedValue({
        code: ADMIN_ERROR_CODES.ADMIN_AUDIT_FAILED,
        httpStatus: 500,
      }),
    };
    const transaction = jest.fn(
      async (fn: (client: unknown) => Promise<unknown>) => fn({}),
    );
    const prisma = { getDb: () => ({ transaction }) };
    const service = new AdminMerchantCommandsService(
      prisma as never,
      merchantReview as never,
      merchants as never,
      sessions as never,
      tracking as never,
      audit as never,
    );
    await expect(service.suspend(admin, 'm1')).rejects.toMatchObject({
      code: ADMIN_ERROR_CODES.ADMIN_AUDIT_FAILED,
    });
    expect(sessions.revokeAllSessionsForAccountInTx).toHaveBeenCalled();
    expect(sessions.finalizeSessionRevocations).not.toHaveBeenCalled();
    expect(tracking.disconnectSessions).not.toHaveBeenCalled();
  });

  it('rolls back driver suspend side effects when audit fails (no Redis/socket finalize)', async () => {
    const driverReview = {
      suspendInTx: jest.fn().mockResolvedValue({
        id: 'd1',
        verificationStatus: 'SUSPENDED',
        alreadySuspended: false,
      }),
    };
    const sessions = {
      revokeAllSessionsForAccountInTx: jest.fn().mockResolvedValue(['s9']),
      finalizeSessionRevocations: jest.fn().mockResolvedValue(undefined),
    };
    const tracking = { disconnectSessions: jest.fn().mockReturnValue(1) };
    const audit = {
      recordInTx: jest.fn().mockRejectedValue({
        code: ADMIN_ERROR_CODES.ADMIN_AUDIT_FAILED,
        httpStatus: 500,
      }),
    };
    const transaction = jest.fn(
      async (fn: (client: unknown) => Promise<unknown>) => fn({}),
    );
    const prisma = { getDb: () => ({ transaction }) };
    const service = new AdminDriverCommandsService(
      prisma as never,
      driverReview as never,
      driversStub() as never,
      sessions as never,
      tracking as never,
      audit as never,
    );
    await expect(service.suspend(admin, 'd1')).rejects.toMatchObject({
      code: ADMIN_ERROR_CODES.ADMIN_AUDIT_FAILED,
    });
    expect(sessions.finalizeSessionRevocations).not.toHaveBeenCalled();
    expect(tracking.disconnectSessions).not.toHaveBeenCalled();
  });

  it('refund create injects requestedByAdminId from CurrentAdmin', async () => {
    const refunds = {
      createRefundInTx: jest.fn().mockResolvedValue({
        id: 'r1',
        requestedByAdminId: 'admin-real',
      }),
    };
    const audit = { recordInTx: jest.fn().mockResolvedValue({}) };
    const notifications = { notifyRefundRefunded: jest.fn() };
    const prisma = mockPrisma();
    const service = new AdminRefundCommandsService(
      prisma as never,
      refunds as never,
      audit as never,
      notifications as never,
    );
    await service.create(admin, {
      orderId: 'o1',
      amountMinor: 100,
      reason: 'test',
      refundMethod: 'MANUAL_OTHER',
    });
    expect(refunds.createRefundInTx).toHaveBeenCalledWith(expect.anything(), {
      orderId: 'o1',
      amountMinor: 100,
      reason: 'test',
      refundMethod: 'MANUAL_OTHER',
      requestedByAdminId: 'admin-real',
    });
  });
});
