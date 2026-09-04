import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { DriverReviewService } from '../../drivers/application/driver-review.service';
import type { DriverProfileView } from '../../drivers/domain/driver.types';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminAuditService } from './admin-audit.service';

/**
 * DriverReviewService has no adminId parameter (kept for unit-test stability).
 * Admin identity is verified by AdminGuard; audit uses CurrentAdmin.adminProfileId.
 * Domain mutation and AuditLog commit in ONE DB transaction; audit failure rolls back.
 */
@Injectable()
export class AdminDriverCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly driverReview: DriverReviewService,
    private readonly audit: AdminAuditService,
  ) {}

  async approveVerification(
    admin: CurrentAdminContext,
    driverId: string,
  ): Promise<DriverProfileView> {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.driverReview.approveInTx(tx, driverId);
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.DRIVER_VERIFICATION_APPROVE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.DRIVER,
        targetId: driverId,
        afterJson: {
          id: result.id,
          verificationStatus: result.verificationStatus,
        },
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async rejectVerification(
    admin: CurrentAdminContext,
    driverId: string,
  ): Promise<DriverProfileView> {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.driverReview.rejectInTx(tx, driverId);
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.DRIVER_VERIFICATION_REJECT,
        targetType: ADMIN_AUDIT_TARGET_TYPES.DRIVER,
        targetId: driverId,
        afterJson: {
          id: result.id,
          verificationStatus: result.verificationStatus,
        },
        sessionId: admin.sessionId,
      });
      return result;
    });
  }

  async suspend(
    admin: CurrentAdminContext,
    driverId: string,
  ): Promise<DriverProfileView> {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.driverReview.suspendInTx(tx, driverId);
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.DRIVER_SUSPEND,
        targetType: ADMIN_AUDIT_TARGET_TYPES.DRIVER,
        targetId: driverId,
        afterJson: {
          id: result.id,
          verificationStatus: result.verificationStatus,
        },
        sessionId: admin.sessionId,
      });
      return result;
    });
  }
}
