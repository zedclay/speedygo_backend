import { ConfigService } from '@nestjs/config';
import { STORAGE_ERROR_CODES } from './domain/storage.errors';
import { S3ObjectStorage } from './adapters/s3-object.storage';

describe('storage production configuration', () => {
  it('fail-fast when S3 required fields are missing', () => {
    try {
      new S3ObjectStorage({
        get: () => '',
      } as ConfigService);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        STORAGE_ERROR_CODES.STORAGE_CONFIG_INVALID,
      );
    }
  });

  it('does not put credentials into thrown messages', () => {
    try {
      new S3ObjectStorage({
        get: (key: string) => {
          if (key === 'storage.s3.secretAccessKey') {
            return 'super-secret-value-do-not-leak';
          }
          return '';
        },
      } as ConfigService);
      throw new Error('expected throw');
    } catch (error) {
      const message = String((error as Error).message ?? error);
      expect(message).not.toContain('super-secret-value-do-not-leak');
      expect((error as { code: string }).code).toBe(
        STORAGE_ERROR_CODES.STORAGE_CONFIG_INVALID,
      );
    }
  });
});
