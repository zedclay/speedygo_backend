import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ADDRESS_DETAIL_LIMITS } from '../../../../../common/address/address-details';
import { CUSTOMER_ADDRESS_TEXT_MAX_LENGTH } from '../../../domain/customer.types';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function optionalNullableTrimmedString(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return value;
}

function OptionalAddressDetail(maxLength: number, example: string) {
  return applyDecorators(
    ApiPropertyOptional({
      nullable: true,
      maxLength,
      example,
      description:
        'Omitted on PATCH leaves the stored value unchanged. null or blank clears it.',
    }),
    IsOptional(),
    Transform(({ value }) => optionalNullableTrimmedString(value)),
    ValidateIf((_, value) => value !== null && value !== undefined),
    IsString(),
    MaxLength(maxLength),
  );
}

export class CreateCustomerProfileDto {
  @ApiProperty({ example: 'Customer Name', maxLength: 255 })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fullName!: string;
}

export class UpdateCustomerProfileDto {
  @ApiPropertyOptional({ example: 'Customer Name', maxLength: 255 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fullName?: string;
}

export class CreateCustomerAddressDto {
  @ApiProperty({ example: 'Home', maxLength: 64 })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  label!: string;

  @ApiProperty({ example: 'Example street 1', maxLength: 500 })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOMER_ADDRESS_TEXT_MAX_LENGTH)
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

  @OptionalAddressDetail(ADDRESS_DETAIL_LIMITS.building, 'Bloc Z')
  building?: string | null;

  @OptionalAddressDetail(ADDRESS_DETAIL_LIMITS.floor, '3')
  floor?: string | null;

  @OptionalAddressDetail(ADDRESS_DETAIL_LIMITS.entrance, 'B')
  entrance?: string | null;

  @OptionalAddressDetail(ADDRESS_DETAIL_LIMITS.landmark, 'Mosquée')
  landmark?: string | null;

  @ApiPropertyOptional({
    description:
      'Ignored by the server. The first address is always default. Later addresses never replace the current default; use PUT /addresses/:addressId/default.',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateCustomerAddressDto {
  @ApiPropertyOptional({ example: 'Work', maxLength: 64 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  label?: string;

  @ApiPropertyOptional({ example: 'Example street 2', maxLength: 500 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOMER_ADDRESS_TEXT_MAX_LENGTH)
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

  @OptionalAddressDetail(ADDRESS_DETAIL_LIMITS.building, 'Bloc Z')
  building?: string | null;

  @OptionalAddressDetail(ADDRESS_DETAIL_LIMITS.floor, '3')
  floor?: string | null;

  @OptionalAddressDetail(ADDRESS_DETAIL_LIMITS.entrance, 'B')
  entrance?: string | null;

  @OptionalAddressDetail(ADDRESS_DETAIL_LIMITS.landmark, 'Mosquée')
  landmark?: string | null;
}
