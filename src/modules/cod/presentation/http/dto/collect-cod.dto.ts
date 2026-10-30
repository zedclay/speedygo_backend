import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { TransformMoneyInputToMinorInt } from '../../../../../common/money/money-input.transform';

export class CollectCodDto {
  @ApiPropertyOptional({
    description: 'v1 only: integer centimes collected',
    example: 65000,
    minimum: 0,
  })
  @ValidateIf((o) => o.collectedAmount === undefined || o.collectedAmount === null)
  @TransformMoneyInputToMinorInt()
  @IsInt()
  @Min(0)
  collectedAmountMinor?: number;

  @ApiPropertyOptional({
    description: 'dzd-v2 only: DZD majors string e.g. "650.00"',
    example: '650.00',
  })
  @ValidateIf(
    (o) =>
      o.collectedAmountMinor === undefined || o.collectedAmountMinor === null,
  )
  @IsOptional()
  @IsString()
  collectedAmount?: string;
}
