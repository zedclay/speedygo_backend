export function isPostgresSqlState(error: unknown, sqlState: string): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 8 && current && typeof current === 'object';
    depth++
  ) {
    const record = current as Record<string, unknown>;
    if (record.sqlState === sqlState || record.code === sqlState) {
      return true;
    }
    current = record.cause ?? record.originalError ?? record.error;
  }
  return false;
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  return isPostgresSqlState(error, '23505');
}

export function isPostgresForeignKeyViolation(error: unknown): boolean {
  return isPostgresSqlState(error, '23503');
}

export function isPostgresCheckViolation(error: unknown): boolean {
  return isPostgresSqlState(error, '23514');
}
