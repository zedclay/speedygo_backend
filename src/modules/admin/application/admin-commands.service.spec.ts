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
