import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClamAvMalwareScanner } from './adapters/clamav-malware.scanner';
import { LocalObjectStorage } from './adapters/local-object.storage';
import { S3ObjectStorage } from './adapters/s3-object.storage';
import { UnavailableMalwareScanner } from './adapters/unavailable-malware.scanner';
import { DocumentObjectRegistry } from './application/document-object.registry';
import { PendingObjectCleanupService } from './application/pending-object-cleanup.service';
import { SecureDocumentStorageService } from './application/secure-document-storage.service';
import { storageConfigInvalid } from './domain/storage.errors';
import {
  MALWARE_SCANNER_PORT,
  OBJECT_STORAGE_PORT,
} from './domain/storage.ports';

function assertProductionStorageConfig(config: ConfigService): void {
  const nodeEnv = config.get<string>('nodeEnv', 'development');
  const driver = config.get<string>('storage.driver', 'local');
  const uploadsEnabled = config.get<boolean>('storage.uploadsEnabled', true);
  if (!uploadsEnabled) {
    return;
  }
  if (nodeEnv === 'production') {
    if (driver === 'local') {
      throw storageConfigInvalid(
        'Production must not use local disk object storage (set STORAGE_DRIVER=s3)',
      );
    }
    if (driver !== 's3') {
      throw storageConfigInvalid(`Unknown STORAGE_DRIVER: ${driver}`);
    }
    if (!config.get<boolean>('storage.malwareScanRequired', false)) {
      throw storageConfigInvalid(
        'Production uploads require STORAGE_MALWARE_SCAN_REQUIRED=true',
      );
    }
    const scannerDriver = config.get<string>(
      'storage.malwareScannerDriver',
      '',
    );
    if (scannerDriver !== 'clamav') {
      throw storageConfigInvalid(
        'Production uploads require STORAGE_MALWARE_SCANNER_DRIVER=clamav',
      );
    }
  }
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    DocumentObjectRegistry,
    SecureDocumentStorageService,
    PendingObjectCleanupService,
    UnavailableMalwareScanner,
    ClamAvMalwareScanner,
    {
      provide: MALWARE_SCANNER_PORT,
      inject: [ConfigService, ClamAvMalwareScanner, UnavailableMalwareScanner],
      useFactory: (
        config: ConfigService,
        clamav: ClamAvMalwareScanner,
        unavailable: UnavailableMalwareScanner,
      ) => {
        const driver = config.get<string>(
          'storage.malwareScannerDriver',
          'unavailable',
        );
        if (driver === 'clamav') {
          return clamav;
        }
        if (driver === 'unavailable' || driver === '' || driver === 'none') {
          return unavailable;
        }
        throw storageConfigInvalid(
          `Unknown STORAGE_MALWARE_SCANNER_DRIVER: ${driver}`,
        );
      },
    },
    {
      provide: OBJECT_STORAGE_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        assertProductionStorageConfig(config);
        const driver = config.get<string>('storage.driver', 'local');
        if (driver === 's3') {
          return new S3ObjectStorage(config);
        }
        if (driver === 'local') {
          return new LocalObjectStorage(config);
        }
        throw storageConfigInvalid(`Unknown STORAGE_DRIVER: ${driver}`);
      },
    },
  ],
  exports: [
    OBJECT_STORAGE_PORT,
    MALWARE_SCANNER_PORT,
    DocumentObjectRegistry,
    SecureDocumentStorageService,
    PendingObjectCleanupService,
  ],
})
export class StorageModule {}
