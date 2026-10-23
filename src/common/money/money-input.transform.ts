import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { parseMoneyMinorDecimalString } from './money-minor';

/**
 * v1 DTO transform only: *Minor = integer centimes.
 * Rejects "650.00" with 400 — that belongs on dzd-v2 amount fields.
 */
export function TransformMoneyInputToMinorInt() {
  return Transform(({ value }) => {
    if (value === null || value === undefined || value === '') {
      return value;
    }
    if (typeof value === 'number' && Number.isInteger(value)) {
      return value;
    }
    if (
      typeof value === 'string' &&
      (value.includes('.') || value.includes(','))
    ) {
      throw new BadRequestException(
        'v1 *Minor fields reject DZD decimals; declare dzd-v2 and send amount string fields',
      );
    }
    try {
      const centimes = parseMoneyMinorDecimalString(value);
      if (
        centimes > BigInt(Number.MAX_SAFE_INTEGER) ||
        centimes < BigInt(Number.MIN_SAFE_INTEGER)
      ) {
        throw new BadRequestException('Money amount exceeds safe integer range');
      }
      return Number(centimes);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Invalid v1 *Minor money input',
      );
    }
  });
}
