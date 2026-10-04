import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import { newObjectId } from '../adapters/local-object.storage';
import {
  assertCoverDimensions,
  detectCoverImage,
  type DetectedCoverImage,
} from '../domain/cover-media.policy';
import {
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_NAMESPACE,
  PRODUCT_IMAGE_PURPOSE,
  productImageObjectKey,
  toProductImageLocator,
} from '../domain/product-image.policy';
import {
  storageFileTooLarge,
  storageObjectMissing,
  storageScanRejected,
  storageScanUnavailable,
  storageUnavailable,
  storageUnsupportedType,
} from '../domain/storage.errors';
import { assertSafeOriginalFilename } from '../domain/content-validation';
import {
  MALWARE_SCANNER_PORT,
  OBJECT_STORAGE_PORT,
  type MalwareScannerPort,
  type ObjectStoragePort,
} from '../domain/storage.ports';
import { DocumentObjectRegistry } from './document-object.registry';

export type ProductImageUploadOwner = {
  accountId: string;
  merchantId: string;
  branchId: string;
  productId: string;
};

@Injectable()
export class ProductImageStorageService {
  constructor(
    @Inject(OBJECT_STORAGE_PORT)
    private readonly objects: ObjectStoragePort,
    @Inject(MALWARE_SCANNER_PORT)
    private readonly scanner: MalwareScannerPort,
    private readonly registry: DocumentObjectRegistry,
    private readonly config: ConfigService,
  ) {}

  async uploadPending(
    owner: ProductImageUploadOwner,
    input: {
      body: Buffer;
      declaredMime?: string;
      originalFilename?: string;
    },
  ): Promise<{
    uploadReference: string;
    contentType: string;
    sizeBytes: number;
    widthPx: number;
    heightPx: number;
    purpose: string;
  }> {
    assertSafeOriginalFilename(input.originalFilename);
    if (input.body.length > PRODUCT_IMAGE_MAX_BYTES) {
      throw storageFileTooLarge('Product image exceeds 2 MiB');
    }
    const detected = detectCoverImage(input.body);
    this.assertDeclaredMime(detected, input.declaredMime);
    assertCoverDimensions(detected.widthPx, detected.heightPx);
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
        purpose: PRODUCT_IMAGE_PURPOSE,
        branchId: owner.branchId,
        productId: owner.productId,
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
      purpose: PRODUCT_IMAGE_PURPOSE,
    };
  }

  async promotePending(input: {
    uploadReference: string;
    accountId: string;
    merchantId: string;
    branchId: string;
    productId: string;
  }): Promise<{
    objectId: string;
    contentType: string;
    byteSize: number;
    widthPx: number;
    heightPx: number;
    locator: string;
  }> {
    const pending = await this.registry.takePending({
      uploadReference: input.uploadReference,
      accountId: input.accountId,
      ownerType: 'MERCHANT',
      ownerId: input.merchantId,
      purpose: PRODUCT_IMAGE_PURPOSE,
      branchId: input.branchId,
      productId: input.productId,
    });
    if (!pending.objectKey.startsWith('pending/')) {
      throw storageObjectMissing();
    }
    const pendingObject = await this.objects.getObject(pending.objectKey);
    if (!pendingObject) {
      throw storageObjectMissing();
    }
    const detected = detectCoverImage(pendingObject.body);
    assertCoverDimensions(detected.widthPx, detected.heightPx);
    const objectId = newObjectId();
    const imageKey = productImageObjectKey(objectId);
    try {
      await this.objects.putObject({
        key: imageKey,
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
      locator: toProductImageLocator(objectId),
    };
  }

  async readImage(objectId: string): Promise<{
    body: Buffer;
    contentType: string;
  }> {
    const object = await this.objects.getObject(productImageObjectKey(objectId));
    if (!object) {
      throw storageObjectMissing();
    }
    return object;
  }

  /**
   * Copies stored product-image bytes to a fresh object id so two products
   * never share an object. Returns null when the source object is missing.
   */
  async copyImage(objectId: string): Promise<{
    objectId: string;
    contentType: string;
    byteSize: number;
    widthPx: number;
    heightPx: number;
  } | null> {
    if (!/^[0-9a-f]{32}$/i.test(objectId)) {
      return null;
    }
    let source: { body: Buffer; contentType: string } | null;
    try {
      source = await this.objects.getObject(productImageObjectKey(objectId));
    } catch {
      throw storageUnavailable();
    }
    if (!source) {
      return null;
    }
    const detected = detectCoverImage(source.body);
    const copyId = newObjectId();
    try {
      await this.objects.putObject({
        key: productImageObjectKey(copyId),
        body: source.body,
        contentType: detected.contentType,
      });
    } catch {
      throw storageUnavailable();
    }
    return {
      objectId: copyId,
      contentType: detected.contentType,
      byteSize: source.body.length,
      widthPx: detected.widthPx,
      heightPx: detected.heightPx,
    };
  }

  async deleteImage(objectId: string): Promise<void> {
    if (!/^[0-9a-f]{32}$/i.test(objectId)) {
      return;
    }
    const key = productImageObjectKey(objectId);
    if (!key.startsWith(PRODUCT_IMAGE_NAMESPACE) || key.includes('..')) {
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
