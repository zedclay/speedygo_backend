import { ApiProperty } from '@nestjs/swagger';

export class CustomerRefundItemDto {
  @ApiProperty()
  refundId!: string;

  @ApiProperty({ example: 2000 })
  amountMinor!: number;

  @ApiProperty({ example: 'DZD' })
  currency!: string;

  @ApiProperty({
    enum: [
      'REQUESTED',
      'UNDER_REVIEW',
      'APPROVED',
      'PROCESSING',
      'REFUNDED',
      'REJECTED',
      'FAILED',
    ],
  })
  status!: string;

  @ApiProperty({
    enum: ['ORIGINAL_PAYMENT', 'MANUAL_COD', 'MANUAL_OTHER'],
  })
  method!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty()
  requestedAt!: string;

  @ApiProperty({ nullable: true, type: String })
  completedAt!: string | null;
}

export class CustomerOrderRefundsResponseDto {
  @ApiProperty()
  orderId!: string;

  @ApiProperty({ example: 10000 })
  originalPaidMinor!: number;

  @ApiProperty({ example: 5000 })
  reservedRefundMinor!: number;

  @ApiProperty({ example: 5000 })
  successfulRefundMinor!: number;

  @ApiProperty({ example: 5000 })
  remainingRefundableMinor!: number;

  @ApiProperty({ example: 'DZD' })
  currency!: string;

  @ApiProperty({ type: [CustomerRefundItemDto] })
  refunds!: CustomerRefundItemDto[];
}
