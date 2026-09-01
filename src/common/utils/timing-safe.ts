import { timingSafeEqual } from 'node:crypto';

export function timingSafeEqualText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    timingSafeEqual(a, Buffer.alloc(a.length, 0));
    return false;
  }
  return timingSafeEqual(a, b);
}
