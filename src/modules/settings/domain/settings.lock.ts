import { createHash } from 'node:crypto';

/** ASCII 'SGST' — SpeedyGo Settings advisory lock class. */
export const SETTINGS_ADVISORY_LOCK_CLASS = 0x53475354;

export function settingsAdvisoryObjectId(key: string): number {
  const digest = createHash('sha256')
    .update('speedygo.platform_setting\0')
    .update(key)
    .digest();
  const value = digest.readInt32BE(0);
  return value === 0 ? 1 : value;
}
