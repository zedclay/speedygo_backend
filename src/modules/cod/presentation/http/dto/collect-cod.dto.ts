import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class CollectCodDto {
  @ApiProperty({
    description:
      'Exact amount of DZD cash collected from the customer (minor units).',
    example: 1200,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  collectedAmountMinor!: number;
}
