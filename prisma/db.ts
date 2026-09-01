import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgisRuntime from '@prisma/orm-extension-postgis/runtime';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';

type PostgresClient = ReturnType<typeof postgres<Contract>>;

function loadContractJson(): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'prisma', 'contract.json'), 'utf8'),
  ) as unknown;
}

let client: PostgresClient | undefined;
let boundUrl: string | undefined;

/**
 * Lazy Prisma 8 client. IDs must be application-generated UUIDv7.
 * BigInt money must be mapped before JSON HTTP responses.
 *
 * PostGIS is part of the frozen contract; the runtime pack must be registered
 * or client construction throws RUNTIME.MISSING_EXTENSION_PACK.
 */
export function getDb(): PostgresClient {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!client || boundUrl !== url) {
    client = postgres<Contract>({
      contractJson: loadContractJson(),
      url,
      extensions: [postgisRuntime],
    });
    boundUrl = url;
  }
  return client;
}

/** Test helper — does not close the pool; next getDb() rebuilds against DATABASE_URL. */
export function resetDbClient(): void {
  client = undefined;
  boundUrl = undefined;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
  }
  resetDbClient();
}

export type SpeedyGoDb = PostgresClient;
