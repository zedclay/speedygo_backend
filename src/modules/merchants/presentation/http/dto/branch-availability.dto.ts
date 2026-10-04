import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  AVAILABILITY_MODES,
  AVAILABILITY_REASON_CODES,
  AVAILABILITY_CUSTOMER_MESSAGE_MAX,
} from '../../../domain/branch-availability.constants';
import { OPENING_HOURS_TIMEZONE } from '../../../domain/opening-hours.constants';

export class PutBranchAvailabilityDto {
  @ApiProperty({
    description: '0 creates; otherwise must match current version',
    example: 0,
  })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiProperty({ enum: AVAILABILITY_MODES })
  @IsIn([...AVAILABILITY_MODES])
  mode!: string;

  @ApiPropertyOptional({ enum: AVAILABILITY_REASON_CODES, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsIn([...AVAILABILITY_REASON_CODES])
  reasonCode?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: AVAILABILITY_CUSTOMER_MESSAGE_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(AVAILABILITY_CUSTOMER_MESSAGE_MAX)
  customerMessage?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'RFC3339; required and future when TEMPORARY_CLOSED',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  closedUntil?: string | null;
}

export class BranchAvailabilityResponseDto {
  @ApiProperty()
  branchId!: string;

  @ApiProperty({ example: OPENING_HOURS_TIMEZONE })
  timezone!: string;

  @ApiProperty({ enum: AVAILABILITY_MODES })
  availabilityMode!: string;

  @ApiProperty({ enum: AVAILABILITY_MODES })
  effectiveMode!: string;

  @ApiProperty()
  hoursConfigured!: boolean;

  @ApiProperty({
    description:
      'Effective accepting-orders (Ouvert). Never inferred from FOLLOW_SCHEDULE alone.',
  })
  isOpenNow!: boolean;

  @ApiProperty()
  acceptingOrders!: boolean;

  @ApiProperty()
  temporaryExpired!: boolean;

  @ApiProperty()
  outsideWeeklyHours!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Hours exception for today (Africa/Algiers), or null. Additive; weekly fallback when null.',
    example: { date: '2026-10-02', closed: true, label: 'Jour férié' },
  })
  hoursException!: { date: string; closed: boolean; label: string } | null;

  @ApiPropertyOptional({ nullable: true })
  reasonCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  customerMessage!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Override expiry only; not a promise the store is open then',
  })
  closedUntil!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Next actual open under effective rules; null when FORCE_CLOSED',
  })
  nextOpenAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  currentClosesAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  version!: number | null;

  @ApiPropertyOptional({ nullable: true })
  updatedAt!: string | null;
}
