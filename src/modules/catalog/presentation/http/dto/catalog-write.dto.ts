import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CATALOG_DESCRIPTION_MAX_LENGTH,
  CATALOG_NAME_MAX_LENGTH,
  CATALOG_PRICE_MINOR_MAX,
  CATALOG_PRODUCT_LIST_MAX_LIMIT,
  CATALOG_PRODUCT_LIST_MAX_OFFSET,
  CATALOG_SELECTION_MAX,
  CATALOG_SORT_ORDER_MAX,
  CATALOG_SORT_ORDER_MIN,
} from '../../../domain/catalog.types';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function toBoolean(value: unknown): unknown {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}

export class CatalogBranchQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;
}

export class ListCatalogProductsQueryDto extends CatalogBranchQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  available?: boolean;

  @ApiPropertyOptional({ maxLength: CATALOG_NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(CATALOG_NAME_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: CATALOG_PRODUCT_LIST_MAX_LIMIT,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CATALOG_PRODUCT_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: CATALOG_PRODUCT_LIST_MAX_OFFSET,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(CATALOG_PRODUCT_LIST_MAX_OFFSET)
  offset?: number;
}

export class CreateCatalogCategoryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ maxLength: CATALOG_NAME_MAX_LENGTH })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(CATALOG_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    minimum: CATALOG_SORT_ORDER_MIN,
    maximum: CATALOG_SORT_ORDER_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(CATALOG_SORT_ORDER_MIN)
  @Max(CATALOG_SORT_ORDER_MAX)
  sortOrder?: number;

  @ApiPropertyOptional({
    description:
      'Customer-facing catalog visibility for this Branch Category. false is not deletion.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCatalogCategoryDto {
  @ApiPropertyOptional({ maxLength: CATALOG_NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(CATALOG_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    minimum: CATALOG_SORT_ORDER_MIN,
    maximum: CATALOG_SORT_ORDER_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(CATALOG_SORT_ORDER_MIN)
  @Max(CATALOG_SORT_ORDER_MAX)
  sortOrder?: number;

  @ApiPropertyOptional({
    description:
      'Customer-facing catalog visibility for this Branch Category. false is not deletion.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateCatalogProductDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ maxLength: CATALOG_NAME_MAX_LENGTH })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(CATALOG_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ maxLength: CATALOG_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(CATALOG_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiProperty({
    description: 'Integer minor units. Zero is allowed. Floats are rejected.',
    example: 1099,
    minimum: 0,
    maximum: CATALOG_PRICE_MINOR_MAX,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(CATALOG_PRICE_MINOR_MAX)
  priceMinor!: number;

  @ApiPropertyOptional({
    description:
      'Whether this Product is currently offered for ordering from this Branch. Not archive, draft, stock, or opening hours.',
  })
  @IsOptional()
  @IsBoolean()
  available?: boolean;
}

export class UpdateCatalogProductDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ maxLength: CATALOG_NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(CATALOG_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: CATALOG_DESCRIPTION_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }) => (value === null ? null : trimString(value)))
  @IsString()
  @MaxLength(CATALOG_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({
    description: 'Integer minor units. Zero is allowed. Floats are rejected.',
    minimum: 0,
    maximum: CATALOG_PRICE_MINOR_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(CATALOG_PRICE_MINOR_MAX)
  priceMinor?: number;

  @ApiPropertyOptional({
    description:
      'Whether this Product is currently offered for ordering from this Branch. Not archive, draft, stock, or opening hours.',
  })
  @IsOptional()
  @IsBoolean()
  available?: boolean;
}

export class CreateCatalogOptionGroupDto {
  @ApiProperty({ maxLength: CATALOG_NAME_MAX_LENGTH })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(CATALOG_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({
    description:
      'required=true requires minSelections>=1. required=false requires minSelections=0.',
  })
  @IsBoolean()
  required!: boolean;

  @ApiProperty({
    description:
      'Must be >= 1 when required=true, and exactly 0 when required=false.',
    minimum: 0,
    maximum: CATALOG_SELECTION_MAX,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(CATALOG_SELECTION_MAX)
  minSelections!: number;

  @ApiProperty({
    description: 'Must be >= 1 and >= minSelections.',
    minimum: 1,
    maximum: CATALOG_SELECTION_MAX,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CATALOG_SELECTION_MAX)
  maxSelections!: number;
}

export class UpdateCatalogOptionGroupDto {
  @ApiPropertyOptional({ maxLength: CATALOG_NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(CATALOG_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: CATALOG_SELECTION_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(CATALOG_SELECTION_MAX)
  minSelections?: number;

  @ApiPropertyOptional({
    description: 'Must be >= 1 and >= minSelections.',
    minimum: 1,
    maximum: CATALOG_SELECTION_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CATALOG_SELECTION_MAX)
  maxSelections?: number;
}

export class CreateCatalogOptionDto {
  @ApiProperty({ maxLength: CATALOG_NAME_MAX_LENGTH })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(CATALOG_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({
    description:
      'Integer minor units added to the product price. Zero is allowed. Negative values are rejected.',
    example: 200,
    minimum: 0,
    maximum: CATALOG_PRICE_MINOR_MAX,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(CATALOG_PRICE_MINOR_MAX)
  additionalPriceMinor!: number;

  @ApiPropertyOptional({
    description:
      'Whether this Option may be selected. Not an archive flag. false keeps the row stored and editable.',
  })
  @IsOptional()
  @IsBoolean()
  available?: boolean;
}

export class UpdateCatalogOptionDto {
  @ApiPropertyOptional({ maxLength: CATALOG_NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(CATALOG_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Integer minor units added to the product price. Zero is allowed. Negative values are rejected.',
    minimum: 0,
    maximum: CATALOG_PRICE_MINOR_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(CATALOG_PRICE_MINOR_MAX)
  additionalPriceMinor?: number;

  @ApiPropertyOptional({
    description:
      'Whether this Option may be selected. Not an archive flag. false keeps the row stored and editable.',
  })
  @IsOptional()
  @IsBoolean()
  available?: boolean;
}
