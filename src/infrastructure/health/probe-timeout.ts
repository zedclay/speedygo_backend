export const READINESS_PROBE_TIMEOUT_MS = 1_500;

export class ProbeTimeoutError extends Error {
  constructor(readonly dependency: string) {
    super(`${dependency} probe timed out`);
    this.name = 'ProbeTimeoutError';
  }
}

export type InFlightSlot<T> = { current: Promise<T> | null };

/**
 * Share one underlying command until it settles. Callers may time out earlier
 * via `withProbeTimeout`; a later probe reuses the same in-flight command
 * instead of enqueueing another.
 */
export function shareUntilSettled<T>(
  slot: InFlightSlot<T>,
  start: () => Promise<T>,
): Promise<T> {
  if (slot.current) {
    return slot.current;
  }
  const pending = start().finally(() => {
    if (slot.current === pending) {
      slot.current = null;
    }
  });
  slot.current = pending;
  return pending;
}

export async function withProbeTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  dependency: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new ProbeTimeoutError(dependency));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
