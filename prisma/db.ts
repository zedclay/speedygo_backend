import 'dotenv/config';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

type PostgresClient = ReturnType<typeof postgres<Contract>>;

let client: PostgresClient | undefined;

/**
 * Lazy Prisma 8 client. IDs must be application-generated UUIDv7.
 * BigInt money must be mapped before JSON HTTP responses.
 */
export function getDb(): PostgresClient {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!client) {
    client = postgres<Contract>({
      contractJson,
      url,
    });
  }
  return client;
}
