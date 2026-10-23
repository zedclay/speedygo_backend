import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import type { SpeedyGoDb } from '../../../prisma/db';
import {
  ProbeTimeoutError,
  READINESS_PROBE_TIMEOUT_MS,
  shareUntilSettled,
  withProbeTimeout,
  type InFlightSlot,
} from '../health/probe-timeout';

export type { SpeedyGoDb };

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly sharedPing: InFlightSlot<void> = { current: null };

  getDb(): SpeedyGoDb {
    // Lazy load so unit tests that mock the repository never execute Prisma ESM.
    const loaded =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../prisma/db') as typeof import('../../../prisma/db');
    return loaded.getDb();
  }

  /** Read-only connectivity probe. Does not write or mutate schema. */
  async ping(timeoutMs = READINESS_PROBE_TIMEOUT_MS): Promise<'up' | 'down' | 'timeout'> {
    try {
      await withProbeTimeout(
        shareUntilSettled(this.sharedPing, () => this.selectOne()),
        timeoutMs,
        'postgres',
      );
      return 'up';
    } catch (error) {
      if (error instanceof ProbeTimeoutError) {
        return 'timeout';
      }
      return 'down';
    }
  }

  private async selectOne(): Promise<void> {
    const db = this.getDb();
    const plan = db.raw
      .sql`SELECT 1::text AS ok`
      .returnsRow({ ok: 'sql/varchar@1' as const })
      .build();
    const result = db.runtime().query(plan) as unknown;
    if (
      result &&
      typeof result === 'object' &&
      Symbol.asyncIterator in result
    ) {
      for await (const _row of result as AsyncIterable<unknown>) {
        break;
      }
    }
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
