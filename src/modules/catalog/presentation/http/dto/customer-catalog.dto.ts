import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN } from '../../../../../common/money/money-minor';
import {
  CUSTOMER_CATALOG_LIST_DEFAULT_LIMIT,
  CUSTOMER_CATALOG_LIST_MAX_LIMIT,
  CUSTOMER_CATALOG_LIST_MAX_OFFSET,
  CUSTOMER_CATALOG_SEARCH_MAX_LENGTH,
  CUSTOMER_CATALOG_SEARCH_MIN_LENGTH,
  CUSTOMER_CATALOG_SORT_NAME,
} from '../../../domain/customer-catalog.policy';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CustomerCatalogPaginationQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: CUSTOMER_CATALOG_LIST_MAX_LIMIT,
    default: CUSTOMER_CATALOG_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CUSTOMER_CATALOG_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: CUSTOMER_CATALOG_LIST_MAX_OFFSET,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(CUSTOMER_CATALOG_LIST_MAX_OFFSET)
  offset?: number;

  @ApiPropertyOptional({
    enum: [CUSTOMER_CATALOG_SORT_NAME],
    default: CUSTOMER_CATALOG_SORT_NAME,
  })
  @IsOptional()
  @IsString()
  sort?: string;
}

export class CustomerCatalogProductListQueryDto extends CustomerCatalogPaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class CustomerCatalogSearchQueryDto extends CustomerCatalogPaginationQueryDto {
  @ApiProperty({
    minLength: CUSTOMER_CATALOG_SEARCH_MIN_LENGTH,
    maxLength: CUSTOMER_CATALOG_SEARCH_MAX_LENGTH,
    description:
      'Trimmed; LIKE wildcards (% _ \\) removed; normalized length must be 2..100. Case-insensitive contains match on storefront/merchant name or product name. Wildcard-only input is rejected.',
  })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(CUSTOMER_CATALOG_SEARCH_MIN_LENGTH)
  @MaxLength(CUSTOMER_CATALOG_SEARCH_MAX_LENGTH)
  q!: string;
}

export class CustomerStorefrontResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty()
  branchName!: string;

  @ApiProperty()
  addressText!: string;

  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;

  @ApiProperty({ format: 'uuid' })
  merchantId!: string;

  @ApiProperty()
  merchantName!: string;

  @ApiProperty()
  merchantPublicReference!: string;
}

export class CustomerStorefrontListResponseDto {
  @ApiProperty({ type: [CustomerStorefrontResponseDto] })
  items!: CustomerStorefrontResponseDto[];

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty()
  total!: number;
}

export class CustomerCategoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  categoryId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  sortOrder!: number;
}

export class CustomerCategoryListResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ type: [CustomerCategoryResponseDto] })
  items!: CustomerCategoryResponseDto[];
}

export class CustomerProductResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Exact Product.id for POST /api/v1/customer/cart/items',
  })
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  categoryId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({
    type: String,
    description:
      'Informational current Product.priceMinor as exact decimal string. Checkout remains authoritative.',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1500',
  })
  priceMinor!: string;
}

export class CustomerProductListResponseDto {
  @ApiProperty({ type: [CustomerProductResponseDto] })
  items!: CustomerProductResponseDto[];

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty()
  total!: number;
}

export class CustomerProductOptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  optionId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    type: String,
    description:
      'DZD integer minor units as exact decimal string (ProductOption.additionalPriceMinor). Non-negative.',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '200',
  })
  additionalPriceMinor!: string;

  @ApiProperty()
  available!: boolean;
}

export class CustomerProductOptionGroupResponseDto {
  @ApiProperty({ format: 'uuid' })
  optionGroupId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  required!: boolean;

  @ApiProperty()
  minSelections!: number;

  @ApiProperty()
  maxSelections!: number;

  @ApiProperty({ type: [CustomerProductOptionResponseDto] })
  options!: CustomerProductOptionResponseDto[];
}

export class CustomerProductDetailResponseDto extends CustomerProductResponseDto {
  @ApiProperty({ type: [CustomerProductOptionGroupResponseDto] })
  optionGroups!: CustomerProductOptionGroupResponseDto[];
}

export class CustomerCatalogSearchStorefrontHitDto {
  @ApiProperty({ enum: ['STOREFRONT'] })
  type!: 'STOREFRONT';

  @ApiProperty({ type: CustomerStorefrontResponseDto })
  storefront!: CustomerStorefrontResponseDto;
}

export class CustomerCatalogSearchProductHitDto {
  @ApiProperty({ enum: ['PRODUCT'] })
  type!: 'PRODUCT';

  @ApiProperty({ type: CustomerProductResponseDto })
  product!: CustomerProductResponseDto;

  @ApiProperty({ type: CustomerStorefrontResponseDto })
  storefront!: CustomerStorefrontResponseDto;
}

export class CustomerCatalogSearchResponseDto {
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: '#/components/schemas/CustomerCatalogSearchStorefrontHitDto' },
        { $ref: '#/components/schemas/CustomerCatalogSearchProductHitDto' },
      ],
    },
  })
  items!: Array<
    CustomerCatalogSearchStorefrontHitDto | CustomerCatalogSearchProductHitDto
  >;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty()
  total!: number;
}
