import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import type { SpeedyGoDb } from '../../../prisma/db';

export type { SpeedyGoDb };

@Injectable()
export class PrismaService implements OnModuleDestroy {
  getDb(): SpeedyGoDb {
    // Lazy load so unit tests that mock the repository never execute Prisma ESM.
    const loaded =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../prisma/db') as typeof import('../../../prisma/db');
    return loaded.getDb();
  }

  async onModuleDestroy(): Promise<void> {
    const loaded =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../prisma/db') as typeof import('../../../prisma/db');
    await loaded.closeDb();
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
