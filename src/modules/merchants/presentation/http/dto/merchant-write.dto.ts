import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
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

export class BindMerchantBranchCoverDto {
  @ApiProperty({
    description:
      'Opaque upload reference from POST .../cover/content (sg-upload:v1:...). Never a path or URL.',
  })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  uploadReference!: string;
}

export class BindMerchantBranchLogoDto {
  @ApiProperty({
    description:
      'Opaque upload reference from POST .../logo/content (sg-upload:v1:...). Never a path or URL.',
  })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  uploadReference!: string;
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

  @ApiPropertyOptional({
    description:
      'Opaque upload reference from POST .../documents/:type/content (sg-upload:v1:...). Never a path or URL.',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  uploadReference?: string;
}

export class MerchantLegalAcceptanceDto {
  @ApiProperty({ example: 'MERCHANT_TERMS' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  kind!: string;

  @ApiProperty({ example: '2026-10-03' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  version!: string;
}

export class SubmitMerchantVerificationDto {
  @ApiPropertyOptional({
    type: [MerchantLegalAcceptanceDto],
    description:
      'Must contain MERCHANT_TERMS and DOSSIER_ACCURACY_DECLARATION at the current active versions (GET /merchant/legal/current). Missing or empty is LEGAL_ACCEPTANCE_REQUIRED.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MerchantLegalAcceptanceDto)
  acceptances?: MerchantLegalAcceptanceDto[];
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

  @ApiProperty({
    example: '16',
    description: 'Official two-digit wilaya code (leading zeros preserved)',
  })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}$/)
  wilayaCode!: string;

  @ApiProperty({
    example: 556,
    description: 'SpeedyGo commune catalogue id belonging to wilayaCode',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  communeId!: number;
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

  @ApiPropertyOptional({
    example: '16',
    description:
      'Official two-digit wilaya code. When set with or without communeId, both must form a valid pair (omitted fields keep existing values).',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}$/)
  wilayaCode?: string;

  @ApiPropertyOptional({
    example: 556,
    description:
      'SpeedyGo commune catalogue id. Explicit administrative edits require a valid wilaya/commune pair.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  communeId?: number;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 2000,
    description:
      'Public storefront description. Empty string or null clears. Merchant legal name is not editable here.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === null ? null : trimString(value)))
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 255,
    description: 'Optional Arabic display name. Empty string or null clears.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === null ? null : trimString(value)))
  @IsString()
  @MaxLength(255)
  nameAr?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 255,
    example: 'contact@example.dz',
    description:
      'Optional public contact email. Must be a valid email when set. Empty string or null clears.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === null ? null : trimString(value)))
  @IsString()
  @MaxLength(255)
  publicEmail?: string | null;
}
