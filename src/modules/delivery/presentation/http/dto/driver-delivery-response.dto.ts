import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DriverCurrentDeliveryResponseDto {
  @ApiProperty()
  assignmentId!: string;

  @ApiProperty({
    description:
      'DriverAssignment.version — required on confirm-pickup when a PENDING pickup handoff exists.',
    minimum: 1,
  })
  assignmentVersion!: number;

  @ApiProperty()
  deliveryId!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  deliveryStatus!: string;

  @ApiProperty()
  orderStatus!: string;

  @ApiProperty()
  fulfillmentStatus!: string;

  @ApiProperty()
  assignmentStatus!: string;

  @ApiProperty({ type: [String] })
  allowedActions!: string[];

  @ApiPropertyOptional({ nullable: true, type: String })
  pickedUpAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  arrivedCustomerAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  deliveredAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'COD Payment.amountMinor as exact integer decimal string when method is COD; null otherwise.',
  })
  expectedCodAmountMinor!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Captured OrderDeliveryAddressSnapshot.addressText. Null when missing.',
  })
  dropoffAddressText!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  dropoffBuilding!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  dropoffFloor!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  dropoffEntrance!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  dropoffLandmark!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Captured snapshot.instructions when present. Structured details use the dropoff* fields.',
  })
  dropoffInstructions!: string | null;
}

export class CurrentDriverDeliveryResponseDto {
  @ApiPropertyOptional({
    type: DriverCurrentDeliveryResponseDto,
    nullable: true,
  })
  delivery!: DriverCurrentDeliveryResponseDto | null;
}
