import { ApiProperty } from '@nestjs/swagger';
import { MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN } from '../../../../../common/money/money-minor';

export class CustomerRefundItemDto {
  @ApiProperty()
  refundId!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '2000',
  })
  amountMinor!: string;

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

  @ApiProperty({
    type: String,
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '10000',
  })
  originalPaidMinor!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '5000',
  })
  reservedRefundMinor!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '5000',
  })
  successfulRefundMinor!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '5000',
  })
  remainingRefundableMinor!: string;

  @ApiProperty({ example: 'DZD' })
  currency!: string;

  @ApiProperty({ type: [CustomerRefundItemDto] })
  refunds!: CustomerRefundItemDto[];
}
