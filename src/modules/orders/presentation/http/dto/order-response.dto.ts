import { ApiProperty } from '@nestjs/swagger';

export class OrderItemOptionResponseDto {
  @ApiProperty({
    description: 'Historical option name copied at Order creation',
  })
  optionNameSnapshot!: string;

  @ApiProperty({
    description: 'Integer minor units snapshotted at Order creation',
  })
  additionalPriceMinor!: number;
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

  @ApiProperty({ description: 'Integer minor units at Order creation' })
  unitPriceMinor!: number;

  @ApiProperty({ description: 'Integer minor units at Order creation' })
  lineTotalMinor!: number;

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
    description:
      'Customer-visible merchandise subtotal in integer minor units (OrderFinancialSnapshot.grossMerchandiseSubtotalMinor). Commission, merchant net, driver remuneration, and SpeedyGo share are not exposed.',
  })
  merchandiseSubtotalMinor!: number;

  @ApiProperty({
    description:
      'Live Delivery Fee snapshotted at Order creation (customerDeliveryFeeMinor)',
  })
  deliveryFeeMinor!: number;

  @ApiProperty({
    description:
      'Customer payable total in integer minor units (maps from OrderFinancialSnapshot.customerPayableMinor). Public API name is customerTotalMinor.',
  })
  customerTotalMinor!: number;
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
