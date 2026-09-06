import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import { newObjectId } from '../adapters/local-object.storage';
import {
  detectDocumentContent,
  requireDeclaredMimeAgreement,
  assertSafeOriginalFilename,
  STORAGE_MAX_BYTES,
} from '../domain/content-validation';
import {
  isLegacyObjectReference,
  parseDurableLocator,
  pendingObjectKey,
  permanentObjectKey,
  toDurableLocator,
} from '../domain/durable-locator';
import {
  storageFileTooLarge,
  storageLegacyReferenceUnavailable,
  storageObjectMissing,
  storageScanRejected,
  storageScanUnavailable,
  storageUnavailable,
  storageUploadReferenceInvalid,
} from '../domain/storage.errors';
import {
  MALWARE_SCANNER_PORT,
  OBJECT_STORAGE_PORT,
  type MalwareScannerPort,
  type ObjectStoragePort,
} from '../domain/storage.ports';
import { DocumentObjectRegistry } from './document-object.registry';

export type UploadOwnerContext = {
  accountId: string;
  ownerType: 'DRIVER' | 'MERCHANT';
  ownerId: string;
  purpose: string;
};

export type UploadContentResult = {
  uploadReference: string;
  contentType: string;
  sizeBytes: number;
  purpose: string;
};

export type BoundDocumentContent = {
  body: Buffer;
  contentType: string;
  downloadFilename: string;
};

export type PromotePendingResult = {
  durableLocator: string;
  contentType: string;
  permanentKey: string;
};

@Injectable()
export class SecureDocumentStorageService {
  constructor(
    @Inject(OBJECT_STORAGE_PORT)
    private readonly objects: ObjectStoragePort,
    @Inject(MALWARE_SCANNER_PORT)
    private readonly scanner: MalwareScannerPort,
    private readonly registry: DocumentObjectRegistry,
    private readonly config: ConfigService,
  ) {}

  async uploadPending(
    owner: UploadOwnerContext,
    input: {
      body: Buffer;
      declaredMime?: string;
      originalFilename?: string;
    },
  ): Promise<UploadContentResult> {
    assertSafeOriginalFilename(input.originalFilename);
    if (input.body.length > STORAGE_MAX_BYTES) {
      throw storageFileTooLarge();
    }
    const detected = detectDocumentContent(input.body);
    requireDeclaredMimeAgreement(detected.contentType, input.declaredMime);

    const scan = await this.scanner.scan({
      body: input.body,
      contentType: detected.contentType,
      filename: input.originalFilename,
    });
    if (scan.status === 'INFECTED') {
      throw storageScanRejected();
    }
    const scanRequired = this.config.get<boolean>(
      'storage.malwareScanRequired',
      false,
    );
    if (scan.status === 'UNAVAILABLE' && scanRequired) {
      throw storageScanUnavailable();
    }

    const uploadId = createUuidV7();
    const pendingId = newObjectId();
    const objectKey = pendingObjectKey(pendingId, detected.extension);

    try {
      await this.objects.putObject({
        key: objectKey,
        body: input.body,
        contentType: detected.contentType,
      });
    } catch {
      throw storageUnavailable();
    }

    try {
      await this.registry.savePending({
        uploadId,
        accountId: owner.accountId,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        purpose: owner.purpose,
        objectKey,
        contentType: detected.contentType,
        sizeBytes: input.body.length,
        createdAt: new Date().toISOString(),
      });
    } catch {
      await this.objects.deleteObject(objectKey).catch(() => undefined);
      throw storageUnavailable();
    }

    return {
      uploadReference: this.registry.toUploadReference(uploadId),
      contentType: detected.contentType,
      sizeBytes: input.body.length,
      purpose: owner.purpose,
    };
  }

  /**
   * Consume pending token, promote bytes to permanent/, return durable locator.
   * Caller must persist locator to PostgreSQL; on DB failure call deletePermanentLocator.
   */
  async promotePendingToPermanent(input: {
    uploadReference: string;
    accountId: string;
    ownerType: 'DRIVER' | 'MERCHANT';
    ownerId: string;
    purpose: string;
  }): Promise<PromotePendingResult> {
    const pending = await this.registry.takePending({
      uploadReference: input.uploadReference,
      accountId: input.accountId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      purpose: input.purpose,
    });
    if (!pending.objectKey.startsWith('pending/')) {
      throw storageObjectMissing();
    }
    const pendingObject = await this.objects.getObject(pending.objectKey);
    if (!pendingObject) {
      throw storageObjectMissing();
    }

    const objectId = newObjectId();
    const permanentKey = permanentObjectKey(objectId);
    try {
      await this.objects.putObject({
        key: permanentKey,
        body: pendingObject.body,
        contentType: pending.contentType,
      });
    } catch {
      throw storageUnavailable();
    }

    await this.objects.deleteObject(pending.objectKey).catch(() => undefined);

    return {
      durableLocator: toDurableLocator(objectId),
      contentType: pending.contentType,
      permanentKey,
    };
  }

  async deletePermanentLocator(durableLocator: string): Promise<void> {
    const objectId = parseDurableLocator(durableLocator);
    if (!objectId) {
      return;
    }
    await this.objects
      .deleteObject(permanentObjectKey(objectId))
      .catch(() => undefined);
  }

  /**
   * Resolve durable PostgreSQL fileUrl against permanent ObjectStorage.
   * Ownership must already be proven via the domain document row.
   * Never consults Redis.
   */
  async readDurableContent(input: {
    durableLocator: string;
    documentId: string;
  }): Promise<BoundDocumentContent> {
    if (isLegacyObjectReference(input.durableLocator)) {
      throw storageLegacyReferenceUnavailable();
    }
    const objectId = parseDurableLocator(input.durableLocator);
    if (!objectId) {
      if (input.durableLocator.startsWith('sg-object:')) {
        throw storageLegacyReferenceUnavailable();
      }
      throw storageUploadReferenceInvalid('Document reference is invalid');
    }
    const object = await this.objects.getObject(permanentObjectKey(objectId));
    if (!object) {
      throw storageObjectMissing();
    }
    const ext =
      object.contentType === 'application/pdf'
        ? 'pdf'
        : object.contentType === 'image/png'
          ? 'png'
          : 'jpg';
    return {
      body: object.body,
      contentType: object.contentType,
      downloadFilename: `document-${input.documentId}.${ext}`,
    };
  }
}
