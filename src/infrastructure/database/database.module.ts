import { Global, Injectable, Module } from '@nestjs/common';

/**
 * Nest wrapper around the Prisma 8 client (`prisma/db.ts`).
 * Contract v1.0 is emitted. Domain repositories are a later task.
 * Call `getDb()` from `prisma/db.ts` when wiring persistence — do not
 * import that file from this module yet (Nest build excludes `prisma/`).
 */
@Injectable()
export class PrismaService {
  getDb() {
    throw new Error(
      'Call getDb() from prisma/db.ts when adding the first persistence use-case. Schema v1.0 is ready.',
    );
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
