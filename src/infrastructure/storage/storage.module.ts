import { Module } from '@nestjs/common';

/**
 * S3-compatible object storage (MinIO locally, ports 9000/9001).
 * Credentials and buckets will be wired when upload use-cases exist.
 */
@Module({})
export class StorageModule {}
