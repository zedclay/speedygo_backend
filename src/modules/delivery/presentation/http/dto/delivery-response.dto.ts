import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DeliveryEventResponseDto {
  @ApiProperty()
  type!: string;

  @ApiProperty()
  occurredAt!: string;

  @ApiProperty({ nullable: true, type: String })
  driverId!: string | null;
}

export class DeliveryPickupResponseDto {
  @ApiProperty()
  merchantBranchId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  addressText!: string;

  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;
}

export class MerchantDeliveryPickupResponseDto extends DeliveryPickupResponseDto {
  @ApiProperty({
    description: 'Live MerchantBranch.phone. Not an Order snapshot.',
  })
  phone!: string;
}

export class DeliveryDropoffResponseDto {
  @ApiProperty({
    description: 'Authoritative OrderDeliveryAddressSnapshot.addressText',
  })
  addressText!: string;

  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;

  @ApiProperty({ nullable: true, type: String })
  instructions!: string | null;
}

export class CustomerDeliveryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty({
    description:
      'Order publicReference (sgo_{uuidhex}). Not an authorization credential.',
  })
  publicReference!: string;

  @ApiProperty({ example: 'SEARCHING_DRIVER' })
  status!: string;

  @ApiProperty()
  orderStatus!: string;

  @ApiProperty()
  fulfillmentStatus!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Accepted DriverProfile.id when Delivery is DRIVER_ASSIGNED. Null before acceptance. No Driver documents or contact.',
  })
  assignedDriverId!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Set to the server timestamp on first SEARCHING_DRIVER creation. Not rewritten on idempotent retries.',
  })
  driverSearchStartedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  pickedUpAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  estimatedArrivalAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  arrivedCustomerAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  deliveredAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ type: DeliveryPickupResponseDto })
  pickup!: DeliveryPickupResponseDto;

  @ApiProperty({ type: DeliveryDropoffResponseDto })
  dropoff!: DeliveryDropoffResponseDto;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Customer Delivery Fee from the immutable OrderFinancialSnapshot. Not Merchant revenue.',
  })
  deliveryFeeMinor!: number | null;

  @ApiProperty({ type: [DeliveryEventResponseDto] })
  events!: DeliveryEventResponseDto[];
}

export class MerchantDeliveryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  publicReference!: string;

  @ApiProperty({ example: 'SEARCHING_DRIVER' })
  status!: string;

  @ApiProperty()
  orderStatus!: string;

  @ApiProperty()
  fulfillmentStatus!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Accepted DriverProfile.id when Delivery is DRIVER_ASSIGNED. Null before acceptance.',
  })
  assignedDriverId!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Set to the server timestamp on first SEARCHING_DRIVER creation. Not rewritten on idempotent retries.',
  })
  driverSearchStartedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  pickedUpAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  estimatedArrivalAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  arrivedCustomerAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  deliveredAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ type: MerchantDeliveryPickupResponseDto })
  pickup!: MerchantDeliveryPickupResponseDto;

  @ApiProperty({ type: DeliveryDropoffResponseDto })
  dropoff!: DeliveryDropoffResponseDto;

  @ApiProperty({ type: [DeliveryEventResponseDto] })
  events!: DeliveryEventResponseDto[];
}
