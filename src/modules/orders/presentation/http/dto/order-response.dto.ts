import { ApiProperty } from '@nestjs/swagger';
import { MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN } from '../../../../../common/money/money-minor';

export class OrderItemOptionResponseDto {
  @ApiProperty({
    description: 'Historical option name copied at Order creation',
  })
  optionNameSnapshot!: string;

  @ApiProperty({
    type: String,
    description: 'Integer minor units snapshotted at Order creation',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '200',
  })
  additionalPriceMinor!: string;
}

export class OrderItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Live Product id when still present. May be null after later Product deletion (ON DELETE SET NULL). Historical name and prices remain on this row.',
  })
  productId!: string | null;

  @ApiProperty()
  productNameSnapshot!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({
    type: String,
    description: 'Integer minor units at Order creation',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1200',
  })
  unitPriceMinor!: string;

  @ApiProperty({
    type: String,
    description: 'Integer minor units at Order creation',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1200',
  })
  lineTotalMinor!: string;

  @ApiProperty({ type: [OrderItemOptionResponseDto] })
  options!: OrderItemOptionResponseDto[];
}

export class OrderAddressSnapshotResponseDto {
  @ApiProperty()
  addressText!: string;

  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Frozen snapshot field. Live Customer Address has no instructions; v1.0 persists null.',
  })
  instructions!: string | null;
}

export class OrderCustomerFinancialResponseDto {
  @ApiProperty({ example: 'DZD' })
  currency!: string;

  @ApiProperty({
    type: String,
    description:
      'Customer-visible merchandise subtotal in integer minor units (OrderFinancialSnapshot.grossMerchandiseSubtotalMinor). Commission, merchant net, driver remuneration, and SpeedyGo share are not exposed.',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1200',
  })
  merchandiseSubtotalMinor!: string;

  @ApiProperty({
    type: String,
    description:
      'Live Delivery Fee snapshotted at Order creation (customerDeliveryFeeMinor)',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '500',
  })
  deliveryFeeMinor!: string;

  @ApiProperty({
    type: String,
    description:
      'Customer payable total in integer minor units (maps from OrderFinancialSnapshot.customerPayableMinor). Public API name is customerTotalMinor.',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1700',
  })
  customerTotalMinor!: string;
}

export class OrderSummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description:
      'Server-generated public reference (sgo_{uuidhex}). Not an authorization credential.',
  })
  publicReference!: string;

  @ApiProperty({ example: 'CREATED' })
  status!: string;

  @ApiProperty({ example: 'PENDING_ACCEPTANCE' })
  fulfillmentStatus!: string;

  @ApiProperty({ enum: ['COD', 'ELECTRONIC'] })
  paymentMethod!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: OrderCustomerFinancialResponseDto })
  financial!: OrderCustomerFinancialResponseDto;
}

export class OrderDetailResponseDto extends OrderSummaryResponseDto {
  @ApiProperty()
  merchantBranchId!: string;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items!: OrderItemResponseDto[];

  @ApiProperty({ type: OrderAddressSnapshotResponseDto })
  deliveryAddress!: OrderAddressSnapshotResponseDto;
}

export class OrderListResponseDto {
  @ApiProperty({ type: [OrderSummaryResponseDto] })
  items!: OrderSummaryResponseDto[];

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty()
  total!: number;
}
