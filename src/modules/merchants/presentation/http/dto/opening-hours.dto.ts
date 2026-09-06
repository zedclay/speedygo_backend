import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  OPENING_HOURS_MAX_INTERVALS_PER_DAY,
  OPENING_HOURS_TIMEZONE,
} from '../../../domain/opening-hours.constants';

export class PutOpeningIntervalDto {
  @ApiProperty({ example: '09:00', description: 'Strict HH:mm' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  opens!: string;

  @ApiProperty({
    example: '17:00',
    description:
      'Strict HH:mm. 00:00→00:00 means 24h (closesNextDay). closes < opens means overnight.',
  })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  closes!: string;
}

export class PutOpeningDayDto {
  @ApiProperty({
    minimum: 1,
    maximum: 7,
    description: 'ISO weekday 1=Mon..7=Sun',
  })
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @ApiProperty({
    type: [PutOpeningIntervalDto],
    description: 'Empty array = closed that day. Max 3 intervals.',
  })
  @IsArray()
  @ArrayMaxSize(OPENING_HOURS_MAX_INTERVALS_PER_DAY)
  @ValidateNested({ each: true })
  @Type(() => PutOpeningIntervalDto)
  intervals!: PutOpeningIntervalDto[];
}

export class PutOpeningHoursDto {
  @ApiProperty({
    description:
      'Optimistic concurrency. 0 creates the first schedule. Otherwise must match current version.',
  })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiProperty({
    type: [PutOpeningDayDto],
    description: 'Exactly 7 unique ISO weekdays.',
  })
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => PutOpeningDayDto)
  days!: PutOpeningDayDto[];
}

export class OpeningIntervalResponseDto {
  @ApiProperty({ example: '09:00' })
  opens!: string;

  @ApiProperty({ example: '17:00' })
  closes!: string;

  @ApiProperty()
  opensMinute!: number;

  @ApiProperty()
  closesMinute!: number;

  @ApiProperty()
  closesNextDay!: boolean;
}

export class OpeningDayResponseDto {
  @ApiProperty({ minimum: 1, maximum: 7 })
  dayOfWeek!: number;

  @ApiProperty({ type: [OpeningIntervalResponseDto] })
  intervals!: OpeningIntervalResponseDto[];
}

export class OpeningHoursResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: OPENING_HOURS_TIMEZONE })
  timezone!: string;

  @ApiProperty()
  hoursConfigured!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'null when hours are not configured yet',
  })
  version!: number | null;

  @ApiPropertyOptional({ nullable: true })
  updatedAt!: string | null;

  @ApiProperty({ type: [OpeningDayResponseDto] })
  days!: OpeningDayResponseDto[];
}
