/**
 * Private object storage port — providers are not authorization authority.
 * Bound documents: PostgreSQL durable locator + permanent ObjectStorage.
 * Redis is pending-token only.
 */

export const OBJECT_STORAGE_PORT = Symbol('OBJECT_STORAGE_PORT');

export type StoredObjectMeta = {
  contentType: string;
  sizeBytes: number;
};

export interface ObjectStoragePort {
  putObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void>;

  getObject(key: string): Promise<{ body: Buffer; contentType: string } | null>;

  deleteObject(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  /**
   * List expired objects under the fixed pending/ namespace only.
   * Adapters must hardcode the pending prefix — never accept a client prefix.
   */
  listExpiredPendingObjects(input: {
    olderThanMs: number;
    limit: number;
  }): Promise<{ keys: string[] }>;
}

export const MALWARE_SCANNER_PORT = Symbol('MALWARE_SCANNER_PORT');

export type MalwareScanResult =
  | { status: 'CLEAN' }
  | { status: 'INFECTED'; reason: string }
  | { status: 'UNAVAILABLE'; reason: string };

export interface MalwareScannerPort {
  /**
   * Scan file bytes. Must not claim CLEAN when no real scanner ran.
   * When scanning is not configured, return UNAVAILABLE (caller decides fail-open/closed).
   */
  scan(input: {
    body: Buffer;
    contentType: string;
    filename?: string;
  }): Promise<MalwareScanResult>;
}
