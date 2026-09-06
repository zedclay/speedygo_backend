import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CUSTOMER_CANCELLATION_REASON_MAX_LENGTH } from '../../../domain/customer-order-cancellation.policy';
import { MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN } from '../../../../../common/money/money-minor';

function trimOptionalString(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === 'string' ? value.trim() : value;
}

export class CancelOrderDto {
  @ApiPropertyOptional({
    description:
      'Optional free-text cancellation reason. Trimmed, max 255. HTML/control characters rejected. Not authority.',
    maxLength: CUSTOMER_CANCELLATION_REASON_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }) => trimOptionalString(value))
  @IsString()
  @MaxLength(CUSTOMER_CANCELLATION_REASON_MAX_LENGTH)
  reason?: string;
}

export class CustomerOrderCancellationResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ example: 'CANCELLED' })
  orderStatus!: string;

  @ApiProperty({
    description:
      'True when cancellation was accepted or already cancelled (idempotent).',
  })
  cancellationAccepted!: boolean;

  @ApiProperty({
    description:
      'True when a durable Refund workflow intent is required/present. Does not mean Customer money was returned.',
  })
  refundRequired!: boolean;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  refundId!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Current Refund status. REQUESTED/APPROVED/PROCESSING ≠ completed refund.',
  })
  refundStatus!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    description: 'Refund amount as decimal string of integer minor units.',
  })
  refundAmountMinor!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Authoritative OrderCancellation.cancelledAt when present.',
  })
  cancelledAt!: string | null;
}
