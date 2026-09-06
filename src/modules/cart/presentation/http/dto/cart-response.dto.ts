import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN } from '../../../../../common/money/money-minor';

export class CartItemSelectedOptionDto {
  @ApiProperty()
  optionId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty({
    type: String,
    description: 'DZD integer minor units as exact decimal string',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1500',
  })
  additionalPriceMinor!: string;

  @ApiProperty()
  available!: boolean;
}

export class CartItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({
    type: String,
    description: 'DZD integer minor units as exact decimal string',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1500',
  })
  baseUnitPriceMinor!: string;

  @ApiProperty({
    type: String,
    description: 'DZD integer minor units as exact decimal string',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1500',
  })
  optionUnitAdditionalMinor!: string;

  @ApiProperty({
    type: String,
    description: 'DZD integer minor units as exact decimal string',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1500',
  })
  unitPriceMinor!: string;

  @ApiProperty({
    type: String,
    description: 'DZD integer minor units as exact decimal string',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1500',
  })
  lineSubtotalMinor!: string;

  @ApiProperty({
    type: String,
    description: 'DZD integer minor units as exact decimal string',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1500',
  })
  storedUnitPriceMinor!: string;

  @ApiProperty({
    description:
      'False when the Product is not currently customer-offerable. The line is not deleted.',
  })
  itemAvailable!: boolean;

  @ApiProperty({ type: [CartItemSelectedOptionDto] })
  selectedOptions!: CartItemSelectedOptionDto[];

  @ApiProperty({ type: [String] })
  warnings!: string[];
}

export class CartResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['ACTIVE', 'ABANDONED', 'CONVERTED'] })
  status!: string;

  @ApiProperty({
    description: 'Branch that owns this Active Cart. Server-derived.',
  })
  branchId!: string;

  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  itemCount!: number;

  @ApiProperty({
    type: String,
    description: 'DZD integer minor units as exact decimal string',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1500',
  })
  cartSubtotalMinor!: string;

  @ApiProperty({
    description:
      'True only when the Cart has items and every line still satisfies Catalog offerability plus persisted OptionGroup min/max/required rules. Does not include Address, DeliveryZone, or payment readiness.',
  })
  cartReady!: boolean;

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ type: [CartItemResponseDto] })
  items!: CartItemResponseDto[];

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class CartBootstrapResponseDto {
  @ApiProperty()
  cartExists!: boolean;

  @ApiPropertyOptional({ type: CartResponseDto, nullable: true })
  cart!: CartResponseDto | null;
}
