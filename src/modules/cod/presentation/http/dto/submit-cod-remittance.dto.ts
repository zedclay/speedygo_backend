import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { TransformMoneyInputToMinorInt } from '../../../../../common/money/money-input.transform';

/**
 * v1: submittedAmountMinor = integer centimes (required under minor-v1).
 * v2: submittedAmount = DZD decimal string "650.00" (required under dzd-v2).
 * Never send ambiguous bare values without declaring the money contract header.
 */
export class SubmitCodRemittanceDto {
  @ApiPropertyOptional({
    description: 'v1 only: integer centimes',
    example: 65000,
    minimum: 1,
  })
  @ValidateIf((o) => o.submittedAmount === undefined || o.submittedAmount === null)
  @TransformMoneyInputToMinorInt()
  @IsInt()
  @Min(1)
  submittedAmountMinor?: number;

  @ApiPropertyOptional({
    description: 'dzd-v2 only: exact DZD majors string',
    example: '650.00',
  })
  @ValidateIf(
    (o) =>
      o.submittedAmountMinor === undefined || o.submittedAmountMinor === null,
  )
  @IsOptional()
  @IsString()
  submittedAmount?: string;
}
