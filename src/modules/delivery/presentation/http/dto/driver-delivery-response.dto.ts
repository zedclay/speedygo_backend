import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DriverCurrentDeliveryResponseDto {
  @ApiProperty()
  assignmentId!: string;

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
}

export class CurrentDriverDeliveryResponseDto {
  @ApiPropertyOptional({
    type: DriverCurrentDeliveryResponseDto,
    nullable: true,
  })
  delivery!: DriverCurrentDeliveryResponseDto | null;
}
