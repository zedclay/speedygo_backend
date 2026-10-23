/**
 * Explicit money API contracts — no unit guessing.
 *
 * v1 (default): *Minor fields = integer centimes digit-strings / numbers ("65000").
 * v2 (header):  DZD majors as scale-2 strings ("650.00") on fields named `amount` /
 *               `submittedAmount` / etc. — never reinterpret *Minor as DZD.
 *
 * Declare contract via:
 *   Accept: application/vnd.speedygo.money.v2+json
 *   or header X-SpeedyGo-Money-Contract: dzd-v2
 */

import {
  centimesFromDzdDecimalString,
  dzdDecimalStringFromCentimes,
  isDzdDecimalString,
  MONEY_DZD_CURRENCY,
} from './money-dzd';
import { parseMoneyMinorDecimalString } from './money-minor';

export const MONEY_CONTRACT_V1_MINOR = 'minor-v1' as const;
export const MONEY_CONTRACT_V2_DZD = 'dzd-v2' as const;
export type MoneyContract =
  | typeof MONEY_CONTRACT_V1_MINOR
  | typeof MONEY_CONTRACT_V2_DZD;

export const MONEY_V2_ACCEPT = 'application/vnd.speedygo.money.v2+json';
export const MONEY_CONTRACT_HEADER = 'x-speedygo-money-contract';

export function resolveMoneyContract(headers: {
  accept?: string;
  [key: string]: string | string[] | undefined;
}): MoneyContract {
  const rawHeader = headers[MONEY_CONTRACT_HEADER] ?? headers['X-SpeedyGo-Money-Contract'];
  const contractHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (contractHeader?.trim().toLowerCase() === MONEY_CONTRACT_V2_DZD) {
    return MONEY_CONTRACT_V2_DZD;
  }
  const accept = headers.accept ?? headers.Accept;
  const acceptStr = Array.isArray(accept) ? accept.join(',') : accept ?? '';
  if (acceptStr.includes(MONEY_V2_ACCEPT)) {
    return MONEY_CONTRACT_V2_DZD;
  }
  return MONEY_CONTRACT_V1_MINOR;
}

/** v2 DZD parse only — "650" and "650.00" both mean 650.00 DZD under dzd-v2. */
export function parseDzdV2ToCentimes(
  raw: unknown,
  options?: { allowNegative?: boolean },
): bigint {
  if (typeof raw === 'number') {
    throw new TypeError(
      'dzd-v2 rejects bare JSON numbers; send exact decimal string e.g. "650.00"',
    );
  }
  if (typeof raw !== 'string') {
    throw new TypeError('dzd-v2 money input must be a decimal string');
  }
  if (!isDzdDecimalString(raw, options) && !/^-?[0-9]+$/.test(raw)) {
    throw new TypeError(
      'dzd-v2 requires DZD major decimal string (e.g. "650" or "650.00")',
    );
  }
  // Under declared dzd-v2, integer digit string means whole dinars.
  return centimesFromDzdDecimalString(raw.includes('.') ? raw : raw);
}

/** v1 *Minor parse only — never accepts "650.00". */
export function parseMinorV1ToCentimes(
  raw: unknown,
  options?: { allowNegative?: boolean },
): bigint {
  return parseMoneyMinorDecimalString(raw, options);
}

/**
 * Parse write body field according to declared contract.
 * Field name *Minor is only valid under v1; under v2 prefer amount / submittedAmount.
 */
export function parseMoneyWriteToCentimes(
  contract: MoneyContract,
  raw: unknown,
  options?: { allowNegative?: boolean },
): bigint {
  if (contract === MONEY_CONTRACT_V2_DZD) {
    return parseDzdV2ToCentimes(raw, options);
  }
  return parseMinorV1ToCentimes(raw, options);
}

export function formatMinorV1(centimes: bigint): string {
  return centimes.toString(10);
}

export function formatDzdV2(centimes: bigint): {
  amount: string;
  currency: typeof MONEY_DZD_CURRENCY;
} {
  return {
    amount: dzdDecimalStringFromCentimes(centimes),
    currency: MONEY_DZD_CURRENCY,
  };
}
