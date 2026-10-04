import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { OPENING_HOURS_TIMEZONE } from '../../../domain/opening-hours.constants';

/**
 * Structural shape only. Time format, ordering, overlap, date range and text
 * limits are domain rules (400 OPENING_HOURS_EXCEPTION_INVALID).
 */
export class PutOpeningHoursExceptionIntervalDto {
  @ApiProperty({ example: '09:00', description: 'Strict HH:mm' })
  @IsString()
  opens!: string;

  @ApiProperty({
    example: '13:00',
    description:
      'Strict HH:mm, after opens. 00:00 means until midnight. Overnight is rejected.',
  })
  @IsString()
  closes!: string;
}

export class PutOpeningHoursExceptionDto {
  @ApiProperty({
    description:
      'Optimistic concurrency. 0 creates the exception for this date; otherwise the current version.',
  })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiProperty({ description: 'true closes the Branch for the whole date' })
  @IsBoolean()
  closed!: boolean;

  @ApiProperty({
    type: [PutOpeningHoursExceptionIntervalDto],
    description: 'Empty when closed. 1–3 same-day intervals when open.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PutOpeningHoursExceptionIntervalDto)
  intervals!: PutOpeningHoursExceptionIntervalDto[];

  @ApiProperty({ example: 'Jour férié', description: '1–80 characters' })
  @IsString()
  label!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Optional, ≤ 500 characters. Stored only (Customer display out of scope).',
  })
  @IsOptional()
  @IsString()
  customerMessage?: string | null;
}

export class OpeningHoursExceptionIntervalResponseDto {
  @ApiProperty({ example: '09:00' })
  opens!: string;

  @ApiProperty({ example: '13:00' })
  closes!: string;
}

export class OpeningHoursExceptionResponseDto {
  @ApiProperty({ example: '2026-10-05' })
  date!: string;

  @ApiProperty()
  closed!: boolean;

  @ApiProperty()
  label!: string;

  @ApiPropertyOptional({ nullable: true })
  customerMessage!: string | null;

  @ApiProperty({ type: [OpeningHoursExceptionIntervalResponseDto] })
  intervals!: OpeningHoursExceptionIntervalResponseDto[];

  @ApiProperty()
  version!: number;

  @ApiProperty()
  updatedAt!: string;
}

export class OpeningHoursExceptionListResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: OPENING_HOURS_TIMEZONE })
  timezone!: string;

  @ApiProperty({
    example: '2026-10-02',
    description: 'Today in Africa/Algiers',
  })
  today!: string;

  @ApiProperty({ type: [OpeningHoursExceptionResponseDto] })
  items!: OpeningHoursExceptionResponseDto[];
}

export class OpeningHoursExceptionDeletedResponseDto {
  @ApiProperty({ example: true })
  deleted!: true;

  @ApiProperty({ example: '2026-10-05' })
  date!: string;
}
