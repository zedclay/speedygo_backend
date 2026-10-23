import { dzdDecimalStringFromCentimes, MONEY_DZD_CURRENCY } from './money-dzd';
import { MONEY_HTTP_FIELD_BY_V1 } from './money-field-catalog';
import {
  MONEY_CONTRACT_V2_DZD,
  type MoneyContract,
} from './money-contract';
import { moneyMinorToDecimalString } from './money-minor';

function centimesFromV1ResponseValue(value: unknown, signed: boolean): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    const digits = moneyMinorToDecimalString(
      typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string'
        ? value
        : String(value),
    );
    const n = BigInt(digits);
    if (!signed && n < 0n) {
      return null;
    }
    return n;
  } catch {
    return null;
  }
}

function projectNode(node: unknown, seen: WeakSet<object>): unknown {
  if (node === null || node === undefined) {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => projectNode(item, seen));
  }
  if (typeof node !== 'object') {
    return node;
  }
  if (seen.has(node)) {
    return node;
  }
  seen.add(node);
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    out[key] = projectNode(value, seen);
    const field = MONEY_HTTP_FIELD_BY_V1.get(key);
    if (!field) {
      continue;
    }
    if (out[field.v2] !== undefined && out[field.v2] !== null) {
      continue;
    }
    const centimes = centimesFromV1ResponseValue(value, field.signed);
    if (centimes === null) {
      continue;
    }
    out[field.v2] = dzdDecimalStringFromCentimes(centimes);
  }
  if (
    Object.keys(out).some((k) => MONEY_HTTP_FIELD_BY_V1.has(k)) &&
    out['currency'] === undefined
  ) {
    out['currency'] = MONEY_DZD_CURRENCY;
  }
  return out;
}

/**
 * Additive dzd-v2 projection: keep *Minor as centimes; add explicit DZD keys.
 * Does not guess unknown keys or reinterpret numbers.
 */
export function projectMoneyPayload(
  payload: unknown,
  contract: MoneyContract,
): unknown {
  if (contract !== MONEY_CONTRACT_V2_DZD) {
    return payload;
  }
  return projectNode(payload, new WeakSet());
}
