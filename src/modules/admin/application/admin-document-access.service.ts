import { Injectable } from '@nestjs/common';
import { SecureDocumentStorageService } from '../../../infrastructure/storage/application/secure-document-storage.service';
import { storageObjectMissing } from '../../../infrastructure/storage/domain/storage.errors';
import { DriverRepository } from '../../drivers/infrastructure/driver.repository';
import { MerchantRepository } from '../../merchants/infrastructure/merchant.repository';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminAuditService } from './admin-audit.service';

export type AdminDocumentDownload = {
  body: Buffer;
  contentType: string;
  downloadFilename: string;
};

/**
 * Sensitive document bytes: AuditLog must succeed before bytes leave the server.
 * Fail closed if audit recording fails.
 */
@Injectable()
export class AdminDocumentAccessService {
  constructor(
    private readonly drivers: DriverRepository,
    private readonly merchants: MerchantRepository,
    private readonly secureDocuments: SecureDocumentStorageService,
    private readonly audit: AdminAuditService,
  ) {}

  async downloadDriverDocument(
    admin: CurrentAdminContext,
    driverId: string,
    documentId: string,
  ): Promise<AdminDocumentDownload> {
    const document = await this.drivers.findDocumentById(documentId);
    if (!document || document.driverId !== driverId) {
      throw storageObjectMissing();
    }
    await this.audit.record({
      adminId: admin.adminProfileId,
      action: ADMIN_AUDIT_ACTIONS.DRIVER_DOCUMENT_READ,
      targetType: ADMIN_AUDIT_TARGET_TYPES.DRIVER,
      targetId: driverId,
      afterJson: {
        documentId: document.id,
        documentType: document.type,
      },
      sessionId: admin.sessionId,
    });
    return this.secureDocuments.readDurableContent({
      durableLocator: document.fileUrl,
      documentId: document.id,
    });
  }

  async downloadMerchantDocument(
    admin: CurrentAdminContext,
    merchantId: string,
    documentId: string,
  ): Promise<AdminDocumentDownload> {
    const document = await this.merchants.findDocumentById(documentId);
    if (!document || document.merchantId !== merchantId) {
      throw storageObjectMissing();
    }
    await this.audit.record({
      adminId: admin.adminProfileId,
      action: ADMIN_AUDIT_ACTIONS.MERCHANT_DOCUMENT_READ,
      targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT,
      targetId: merchantId,
      afterJson: {
        documentId: document.id,
        documentType: document.type,
      },
      sessionId: admin.sessionId,
    });
    return this.secureDocuments.readDurableContent({
      durableLocator: document.fileUrl,
      documentId: document.id,
    });
  }
}
