import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { CodFoundationService } from '../../cod/application/cod-foundation.service';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminAuditService } from './admin-audit.service';

/**
 * Domain mutation and AuditLog commit in ONE DB transaction; audit failure rolls back.
 */
@Injectable()
export class AdminCodCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cod: CodFoundationService,
    private readonly audit: AdminAuditService,
  ) {}

  async confirmRemittance(
    admin: CurrentAdminContext,
    remittanceId: string,
    confirmedAmountMinor: number,
  ) {
    return this.prisma.getDb().transaction(async (tx) => {
      const result = await this.cod.confirmCodRemittanceInTx(
        tx,
        remittanceId,
        confirmedAmountMinor,
      );
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.COD_REMITTANCE_CONFIRM,
        targetType: ADMIN_AUDIT_TARGET_TYPES.COD_REMITTANCE,
        targetId: remittanceId,
        afterJson: result,
        sessionId: admin.sessionId,
      });
      return result;
    });
  }
}
