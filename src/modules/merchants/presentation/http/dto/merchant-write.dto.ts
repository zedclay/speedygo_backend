import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MERCHANT_BRANCH_ADDRESS_TEXT_MAX_LENGTH } from '../../../domain/merchant.types';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateMerchantProfileDto {
  @ApiProperty({ example: 'Example Merchant', maxLength: 255 })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}

export class UpdateMerchantProfileDto {
  @ApiPropertyOptional({ example: 'Example Merchant', maxLength: 255 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;
}

export class UpsertMerchantDocumentDto {
  @ApiPropertyOptional({
    example: '2099-01-01',
    description:
      'Optional for all SpeedyGo application evidence categories. YYYY-MM-DD. When present, must not be in the past. Not an Algerian statutory requirement.',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expiryDate?: string;
}

export class CreateMerchantBranchDto {
  @ApiProperty({ example: 'Main branch', maxLength: 255 })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ example: '0550123456', maxLength: 32 })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone!: string;

  @ApiProperty({ example: 'Example street 1', maxLength: 500 })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MERCHANT_BRANCH_ADDRESS_TEXT_MAX_LENGTH)
  addressText!: string;

  @ApiProperty({ example: 36.75, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: 3.05, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}

export class UpdateMerchantBranchDto {
  @ApiPropertyOptional({ example: 'Downtown', maxLength: 255 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: '0550123456', maxLength: 32 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ example: 'Example street 2', maxLength: 500 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MERCHANT_BRANCH_ADDRESS_TEXT_MAX_LENGTH)
  addressText?: string;

  @ApiPropertyOptional({ example: 36.76, minimum: -90, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 3.06, minimum: -180, maximum: 180 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}
