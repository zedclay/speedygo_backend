import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { DRIVER_VEHICLE_TYPES } from '../../../domain/driver.policy';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateDriverProfileDto {
  @ApiProperty({ example: 'Driver Name', maxLength: 255 })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fullName!: string;
}

export class UpdateDriverProfileDto {
  @ApiPropertyOptional({ example: 'Driver Name', maxLength: 255 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fullName?: string;
}

export class UpsertDriverDocumentDto {
  @ApiPropertyOptional({
    example: '2099-01-01',
    description:
      'Required for DRIVING_LICENSE. Optional for IDENTITY. YYYY-MM-DD. Must not be in the past.',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expiryDate?: string;
}

export class CreateDriverVehicleDto {
  @ApiProperty({ enum: DRIVER_VEHICLE_TYPES })
  @IsIn(DRIVER_VEHICLE_TYPES)
  type!: (typeof DRIVER_VEHICLE_TYPES)[number];

  @ApiProperty({ example: '12345-123-01', maxLength: 32 })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  plateNumber!: string;

  @ApiProperty({ example: 'Yamaha NMAX', maxLength: 128 })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  model!: string;

  @ApiPropertyOptional({ example: 'Black', maxLength: 64 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  color?: string;
}

export class UpdateDriverVehicleDto {
  @ApiPropertyOptional({ enum: DRIVER_VEHICLE_TYPES })
  @IsOptional()
  @IsIn(DRIVER_VEHICLE_TYPES)
  type?: (typeof DRIVER_VEHICLE_TYPES)[number];

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  plateNumber?: string;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  model?: string;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  color?: string;
}
