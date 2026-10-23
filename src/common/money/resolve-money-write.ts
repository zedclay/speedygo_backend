import { BadRequestException } from '@nestjs/common';
import {
  MONEY_CONTRACT_V2_DZD,
  parseDzdV2ToCentimes,
  parseMinorV1ToCentimes,
  resolveMoneyContract,
  type MoneyContract,
} from './money-contract';

export function moneyContractFromHeaders(headers: Record<string, unknown>): MoneyContract {
  const normalized: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    normalized[k.toLowerCase()] = v as string | string[] | undefined;
  }
  return resolveMoneyContract(normalized);
}

/**
 * Resolve centimes from v1 *Minor XOR v2 amount field per declared contract.
 */
export function resolveWriteCentimes(input: {
  headers: Record<string, unknown>;
  minorField?: unknown;
  dzdField?: unknown;
  fieldLabel: string;
}): number {
  const contract = moneyContractFromHeaders(input.headers);
  try {
    if (contract === MONEY_CONTRACT_V2_DZD) {
      if (input.dzdField === undefined || input.dzdField === null) {
        throw new BadRequestException(
          `dzd-v2 requires ${input.fieldLabel} as DZD decimal string (e.g. "650.00"); do not use *Minor`,
        );
      }
      if (input.minorField !== undefined && input.minorField !== null) {
        throw new BadRequestException(
          'dzd-v2 rejects *Minor fields; send DZD amount string only',
        );
      }
      const c = parseDzdV2ToCentimes(input.dzdField);
      return Number(c);
    }
    if (input.minorField === undefined || input.minorField === null) {
      throw new BadRequestException(
        `minor-v1 requires ${input.fieldLabel}Minor as integer centimes`,
      );
    }
    if (input.dzdField !== undefined && input.dzdField !== null) {
      throw new BadRequestException(
        'minor-v1 rejects DZD amount fields; send *Minor centimes only',
      );
    }
    const c = parseMinorV1ToCentimes(input.minorField);
    return Number(c);
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException(
      e instanceof Error ? e.message : 'Invalid money input for declared contract',
    );
  }
}

/** Same XOR rules; returns undefined when neither field is present (PATCH). */
export function resolveWriteCentimesOptional(input: {
  headers: Record<string, unknown>;
  minorField?: unknown;
  dzdField?: unknown;
  fieldLabel: string;
}): number | undefined {
  const hasMinor = input.minorField !== undefined && input.minorField !== null;
  const hasDzd = input.dzdField !== undefined && input.dzdField !== null;
  if (!hasMinor && !hasDzd) {
    return undefined;
  }
  return resolveWriteCentimes(input);
}
