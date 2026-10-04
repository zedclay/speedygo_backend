/**
 * Drains a Prisma 8 raw query result (array, promise or async iterable) into rows.
 */
export async function consumeRawRows<T>(result: unknown): Promise<T[]> {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (
    result != null &&
    typeof (result as Promise<unknown>).then === 'function'
  ) {
    return consumeRawRows(await (result as Promise<unknown>));
  }
  if (
    result != null &&
    typeof result === 'object' &&
    Symbol.asyncIterator in result
  ) {
    const rows: T[] = [];
    for await (const row of result as AsyncIterable<T>) {
      rows.push(row);
    }
    return rows;
  }
  throw new Error('Raw query returned an unexpected result');
}
