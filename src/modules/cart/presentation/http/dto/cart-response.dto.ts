import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CartItemSelectedOptionDto {
  @ApiProperty()
  optionId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty({
    description:
      'Live ProductOption.additionalPriceMinor in integer minor units.',
  })
  additionalPriceMinor!: number;

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
    description:
      'Live Product.priceMinor in integer minor units. Not a checkout snapshot.',
  })
  baseUnitPriceMinor!: number;

  @ApiProperty({
    description:
      'Sum of live selected ProductOption.additionalPriceMinor. Integer minor units.',
  })
  optionUnitAdditionalMinor!: number;

  @ApiProperty({
    description:
      'baseUnitPriceMinor + optionUnitAdditionalMinor. Live Catalog, not checkout-authoritative.',
  })
  unitPriceMinor!: number;

  @ApiProperty({
    description: 'unitPriceMinor * quantity. Integer minor units.',
  })
  lineSubtotalMinor!: number;

  @ApiProperty({
    description:
      'Last validated unit merchandise price written on CartItem (Product.priceMinor + selected option additionalPriceMinor at write time). Not checkout-authoritative.',
  })
  storedUnitPriceMinor!: number;

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
    description:
      'Sum of line subtotals in integer minor units. No delivery fee, discount, commission, or payment.',
  })
  cartSubtotalMinor!: number;

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
