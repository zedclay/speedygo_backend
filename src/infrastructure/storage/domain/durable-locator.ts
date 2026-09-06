/**
 * Durable opaque locators for verification document bytes.
 * Redis is never required after bind — PostgreSQL fileUrl + permanent ObjectStorage.
 */

export const DURABLE_OBJECT_PREFIX = 'sg-object:v1:';
export const PENDING_NAMESPACE = 'pending/';
export const PERMANENT_NAMESPACE = 'permanent/';

/** Fixed allowlisted pending prefix — never client-controlled. */
export const PENDING_LIST_PREFIX = PENDING_NAMESPACE;

export function toDurableLocator(objectId: string): string {
  return `${DURABLE_OBJECT_PREFIX}${objectId}`;
}

/**
 * Parse durable locator → opaque object id.
 * Rejects path traversal, separators, and non-hex ids.
 */
export function parseDurableLocator(ref: string): string | null {
  if (typeof ref !== 'string' || !ref.startsWith(DURABLE_OBJECT_PREFIX)) {
    return null;
  }
  const id = ref.slice(DURABLE_OBJECT_PREFIX.length).trim();
  if (
    id.length === 0 ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('..') ||
    id.includes('\0') ||
    !/^[0-9a-f]{32}$/i.test(id)
  ) {
    return null;
  }
  return id.toLowerCase();
}

export function permanentObjectKey(objectId: string): string {
  return `${PERMANENT_NAMESPACE}${objectId}`;
}

export function pendingObjectKey(objectId: string, extension: string): string {
  const ext = extension.replace(/[^a-z0-9]/gi, '');
  if (!ext) {
    throw new Error('Invalid pending extension');
  }
  return `${PENDING_NAMESPACE}${objectId}.${ext}`;
}

/** Legacy metadata-only forms (pre durable v1). */
export function isLegacyObjectReference(ref: string): boolean {
  if (typeof ref !== 'string' || !ref.startsWith('sg-object:')) {
    return false;
  }
  if (ref.startsWith(DURABLE_OBJECT_PREFIX)) {
    return false;
  }
  return true;
}
