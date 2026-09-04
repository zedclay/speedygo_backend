import {
  canAdminClose,
  canAdminReopen,
  canAdminResolve,
  canAdminStart,
  canAdminWaitCustomer,
  canUserReply,
  parseSupportPriority,
  parseSupportStatus,
  statusAfterUserReply,
  SUPPORT_PRIORITY_HIGH,
  SUPPORT_PRIORITY_LOW,
  SUPPORT_PRIORITY_NORMAL,
  SUPPORT_STATUS_CLOSED,
  SUPPORT_STATUS_IN_PROGRESS,
  SUPPORT_STATUS_OPEN,
  SUPPORT_STATUS_RESOLVED,
  SUPPORT_STATUS_WAITING_CUSTOMER,
} from './support.policy';
import { ADMIN_PERMISSIONS } from '../../admin/domain/admin-permissions';

describe('Support policy', () => {
  describe('status vocabulary', () => {
    it('parses frozen statuses only', () => {
      expect(parseSupportStatus(SUPPORT_STATUS_OPEN)).toBe('OPEN');
      expect(parseSupportStatus('URGENT')).toBeNull();
      expect(parseSupportStatus('PENDING')).toBeNull();
      expect(parseSupportStatus('DONE')).toBeNull();
      expect(parseSupportStatus('REFUNDED')).toBeNull();
      expect(parseSupportPriority('CRITICAL')).toBeNull();
      expect(parseSupportPriority('URGENT')).toBeNull();
    });

    it('parses frozen priorities only', () => {
      expect(parseSupportPriority(SUPPORT_PRIORITY_NORMAL)).toBe('NORMAL');
      expect(parseSupportPriority(SUPPORT_PRIORITY_LOW)).toBe('LOW');
      expect(parseSupportPriority(SUPPORT_PRIORITY_HIGH)).toBe('HIGH');
      expect(parseSupportPriority('URGENT')).toBeNull();
    });
  });

  describe('user reply transitions', () => {
    it('allows reply on OPEN, IN_PROGRESS, WAITING_CUSTOMER', () => {
      expect(canUserReply(SUPPORT_STATUS_OPEN)).toBe(true);
      expect(canUserReply(SUPPORT_STATUS_IN_PROGRESS)).toBe(true);
      expect(canUserReply(SUPPORT_STATUS_WAITING_CUSTOMER)).toBe(true);
      expect(canUserReply(SUPPORT_STATUS_RESOLVED)).toBe(false);
      expect(canUserReply(SUPPORT_STATUS_CLOSED)).toBe(false);
    });

    it('moves WAITING_CUSTOMER to IN_PROGRESS on user reply', () => {
      expect(statusAfterUserReply(SUPPORT_STATUS_WAITING_CUSTOMER)).toBe(
        SUPPORT_STATUS_IN_PROGRESS,
      );
      expect(statusAfterUserReply(SUPPORT_STATUS_OPEN)).toBe(
        SUPPORT_STATUS_OPEN,
      );
      expect(statusAfterUserReply(SUPPORT_STATUS_IN_PROGRESS)).toBe(
        SUPPORT_STATUS_IN_PROGRESS,
      );
    });
  });

  describe('admin transitions', () => {
    it('start only from OPEN', () => {
      expect(canAdminStart(SUPPORT_STATUS_OPEN)).toBe(true);
      expect(canAdminStart(SUPPORT_STATUS_IN_PROGRESS)).toBe(false);
    });

    it('wait-customer from OPEN or IN_PROGRESS', () => {
      expect(canAdminWaitCustomer(SUPPORT_STATUS_OPEN)).toBe(true);
      expect(canAdminWaitCustomer(SUPPORT_STATUS_IN_PROGRESS)).toBe(true);
      expect(canAdminWaitCustomer(SUPPORT_STATUS_WAITING_CUSTOMER)).toBe(false);
      expect(canAdminWaitCustomer(SUPPORT_STATUS_RESOLVED)).toBe(false);
    });

    it('resolve from open-ish only', () => {
      expect(canAdminResolve(SUPPORT_STATUS_OPEN)).toBe(true);
      expect(canAdminResolve(SUPPORT_STATUS_IN_PROGRESS)).toBe(true);
      expect(canAdminResolve(SUPPORT_STATUS_WAITING_CUSTOMER)).toBe(true);
      expect(canAdminResolve(SUPPORT_STATUS_RESOLVED)).toBe(false);
      expect(canAdminResolve(SUPPORT_STATUS_CLOSED)).toBe(false);
    });

    it('close only from RESOLVED', () => {
      expect(canAdminClose(SUPPORT_STATUS_RESOLVED)).toBe(true);
      expect(canAdminClose(SUPPORT_STATUS_OPEN)).toBe(false);
      expect(canAdminClose(SUPPORT_STATUS_CLOSED)).toBe(false);
    });

    it('reopen from RESOLVED or CLOSED', () => {
      expect(canAdminReopen(SUPPORT_STATUS_RESOLVED)).toBe(true);
      expect(canAdminReopen(SUPPORT_STATUS_CLOSED)).toBe(true);
      expect(canAdminReopen(SUPPORT_STATUS_OPEN)).toBe(false);
    });
  });

  describe('finance separation', () => {
    it('support permission codes are distinct from finance mutations', () => {
      expect(ADMIN_PERMISSIONS.SUPPORT_READ).toBe('support.read');
      expect(ADMIN_PERMISSIONS.SUPPORT_MANAGE).toBe('support.manage');
      expect(ADMIN_PERMISSIONS.SUPPORT_MANAGE).not.toBe(
        ADMIN_PERMISSIONS.REFUNDS_MANAGE,
      );
      expect(ADMIN_PERMISSIONS.SUPPORT_MANAGE).not.toBe(
        ADMIN_PERMISSIONS.SETTLEMENTS_MANAGE,
      );
      expect(ADMIN_PERMISSIONS.SUPPORT_MANAGE).not.toBe(
        ADMIN_PERMISSIONS.COD_REMITTANCE_CONFIRM,
      );
      expect(ADMIN_PERMISSIONS.SUPPORT_READ).not.toBe(
        ADMIN_PERMISSIONS.LEDGER_READ,
      );
    });
  });
});
