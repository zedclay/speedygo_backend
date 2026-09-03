import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class SubmitCodRemittanceDto {
  @ApiProperty({
    description:
      'Cash amount the driver declares as remitted to SpeedyGo (minor units). Must be > 0 and <= outstanding custody. Does not reduce custody until internal confirmation.',
    example: 2500,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  submittedAmountMinor!: number;
}
