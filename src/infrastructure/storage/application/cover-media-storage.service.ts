import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import { newObjectId } from '../adapters/local-object.storage';
import {
  assertCoverDimensions,
  assertLogoDimensions,
  COVER_MAX_BYTES,
  COVER_NAMESPACE,
  COVER_PURPOSE,
  coverObjectKey,
  detectCoverImage,
  LOGO_MAX_BYTES,
  LOGO_NAMESPACE,
  LOGO_PURPOSE,
  logoObjectKey,
  toCoverLocator,
  toLogoLocator,
  type DetectedCoverImage,
} from '../domain/cover-media.policy';
import {
  storageFileTooLarge,
  storageObjectMissing,
  storageUnsupportedType,
  storageScanRejected,
  storageScanUnavailable,
  storageUnavailable,
} from '../domain/storage.errors';
import { assertSafeOriginalFilename } from '../domain/content-validation';
import {
  MALWARE_SCANNER_PORT,
  OBJECT_STORAGE_PORT,
  type MalwareScannerPort,
  type ObjectStoragePort,
} from '../domain/storage.ports';
import { DocumentObjectRegistry } from './document-object.registry';

export type CoverUploadOwner = {
  accountId: string;
  merchantId: string;
  branchId: string;
};

type BranchMediaKind = {
  subject: 'Cover' | 'Logo';
  purpose: string;
  maxBytes: number;
  tooLargeMessage: string;
  namespace: string;
  objectKey: (objectId: string) => string;
  locator: (objectId: string) => string;
  assertDimensions: (widthPx: number, heightPx: number) => void;
};

const COVER_KIND: BranchMediaKind = {
  subject: 'Cover',
  purpose: COVER_PURPOSE,
  maxBytes: COVER_MAX_BYTES,
  tooLargeMessage: 'Cover exceeds 2 MiB',
  namespace: COVER_NAMESPACE,
  objectKey: coverObjectKey,
  locator: toCoverLocator,
  assertDimensions: assertCoverDimensions,
};

const LOGO_KIND: BranchMediaKind = {
  subject: 'Logo',
  purpose: LOGO_PURPOSE,
  maxBytes: LOGO_MAX_BYTES,
  tooLargeMessage: 'Logo exceeds 1 MiB',
  namespace: LOGO_NAMESPACE,
  objectKey: logoObjectKey,
  locator: toLogoLocator,
  assertDimensions: assertLogoDimensions,
};

type PendingUploadResult = {
  uploadReference: string;
  contentType: string;
  sizeBytes: number;
  widthPx: number;
  heightPx: number;
  purpose: string;
};

type PromotedMedia = {
  objectId: string;
  contentType: string;
  byteSize: number;
  widthPx: number;
  heightPx: number;
  locator: string;
};

type PromoteInput = {
  uploadReference: string;
  accountId: string;
  merchantId: string;
  branchId: string;
};

@Injectable()
export class CoverMediaStorageService {
  constructor(
    @Inject(OBJECT_STORAGE_PORT)
    private readonly objects: ObjectStoragePort,
    @Inject(MALWARE_SCANNER_PORT)
    private readonly scanner: MalwareScannerPort,
    private readonly registry: DocumentObjectRegistry,
    private readonly config: ConfigService,
  ) {}

  uploadPending(
    owner: CoverUploadOwner,
    input: {
      body: Buffer;
      declaredMime?: string;
      originalFilename?: string;
    },
  ): Promise<PendingUploadResult> {
    return this.uploadPendingKind(COVER_KIND, owner, input);
  }

  uploadPendingLogo(
    owner: CoverUploadOwner,
    input: {
      body: Buffer;
      declaredMime?: string;
      originalFilename?: string;
    },
  ): Promise<PendingUploadResult> {
    return this.uploadPendingKind(LOGO_KIND, owner, input);
  }

  promotePending(input: PromoteInput): Promise<PromotedMedia> {
    return this.promotePendingKind(COVER_KIND, input);
  }

  promotePendingLogo(input: PromoteInput): Promise<PromotedMedia> {
    return this.promotePendingKind(LOGO_KIND, input);
  }

  readCover(objectId: string): Promise<{
    body: Buffer;
    contentType: string;
  }> {
    return this.readKind(COVER_KIND, objectId);
  }

  readLogo(objectId: string): Promise<{
    body: Buffer;
    contentType: string;
  }> {
    return this.readKind(LOGO_KIND, objectId);
  }

  deleteCover(objectId: string): Promise<void> {
    return this.deleteKind(COVER_KIND, objectId);
  }

  deleteLogo(objectId: string): Promise<void> {
    return this.deleteKind(LOGO_KIND, objectId);
  }

  private async uploadPendingKind(
    kind: BranchMediaKind,
    owner: CoverUploadOwner,
    input: {
      body: Buffer;
      declaredMime?: string;
      originalFilename?: string;
    },
  ): Promise<PendingUploadResult> {
    assertSafeOriginalFilename(input.originalFilename);
    if (input.body.length > kind.maxBytes) {
      throw storageFileTooLarge(kind.tooLargeMessage);
    }
    const detected = detectCoverImage(input.body, kind.subject);
    this.assertDeclaredMime(detected, input.declaredMime);
    kind.assertDimensions(detected.widthPx, detected.heightPx);
    await this.scan(input.body, detected.contentType, input.originalFilename);

    const uploadId = createUuidV7();
    const pendingId = newObjectId();
    const objectKey = `pending/${pendingId}.${detected.extension}`;
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
        ownerType: 'MERCHANT',
        ownerId: owner.merchantId,
        purpose: kind.purpose,
        branchId: owner.branchId,
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
      widthPx: detected.widthPx,
      heightPx: detected.heightPx,
      purpose: kind.purpose,
    };
  }

  private async promotePendingKind(
    kind: BranchMediaKind,
    input: PromoteInput,
  ): Promise<PromotedMedia> {
    const pending = await this.registry.takePending({
      uploadReference: input.uploadReference,
      accountId: input.accountId,
      ownerType: 'MERCHANT',
      ownerId: input.merchantId,
      purpose: kind.purpose,
      branchId: input.branchId,
    });
    if (!pending.objectKey.startsWith('pending/')) {
      throw storageObjectMissing();
    }
    const pendingObject = await this.objects.getObject(pending.objectKey);
    if (!pendingObject) {
      throw storageObjectMissing();
    }
    const detected = detectCoverImage(pendingObject.body, kind.subject);
    kind.assertDimensions(detected.widthPx, detected.heightPx);
    const objectId = newObjectId();
    const key = kind.objectKey(objectId);
    try {
      await this.objects.putObject({
        key,
        body: pendingObject.body,
        contentType: detected.contentType,
      });
    } catch {
      throw storageUnavailable();
    }
    await this.objects.deleteObject(pending.objectKey).catch(() => undefined);
    return {
      objectId,
      contentType: detected.contentType,
      byteSize: pendingObject.body.length,
      widthPx: detected.widthPx,
      heightPx: detected.heightPx,
      locator: kind.locator(objectId),
    };
  }

  private async readKind(
    kind: BranchMediaKind,
    objectId: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const object = await this.objects.getObject(kind.objectKey(objectId));
    if (!object) {
      throw storageObjectMissing();
    }
    return object;
  }

  private async deleteKind(kind: BranchMediaKind, objectId: string): Promise<void> {
    if (!/^[0-9a-f]{32}$/i.test(objectId)) {
      return;
    }
    const key = kind.objectKey(objectId);
    if (!key.startsWith(kind.namespace) || key.includes('..')) {
      return;
    }
    await this.objects.deleteObject(key).catch(() => undefined);
  }

  private assertDeclaredMime(
    detected: DetectedCoverImage,
    declaredMime: string | undefined,
  ): void {
    if (!declaredMime?.trim()) {
      return;
    }
    const normalized = declaredMime.split(';')[0]?.trim().toLowerCase() ?? '';
    if (normalized === 'image/jpg') {
      if (detected.contentType !== 'image/jpeg') {
        throw storageUnsupportedType('Declared MIME does not match file content');
      }
      return;
    }
    if (normalized !== detected.contentType) {
      throw storageUnsupportedType('Declared MIME does not match file content');
    }
  }

  private async scan(
    body: Buffer,
    contentType: string,
    filename?: string,
  ): Promise<void> {
    const scan = await this.scanner.scan({ body, contentType, filename });
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
  }
}
