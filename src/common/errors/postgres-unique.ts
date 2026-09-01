export function isPostgresUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 8 && current && typeof current === 'object';
    depth++
  ) {
    const record = current as Record<string, unknown>;
    if (record.sqlState === '23505' || record.code === '23505') {
      return true;
    }
    current = record.cause ?? record.originalError ?? record.error;
  }
  return false;
}
