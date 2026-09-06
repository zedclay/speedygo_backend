import { ApiProperty } from '@nestjs/swagger';
import { MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN } from '../../../../../common/money/money-minor';

export class CustomerPaymentResponseDto {
  @ApiProperty()
  paymentId!: string;

  @ApiProperty({ enum: ['COD', 'ELECTRONIC'] })
  method!: string;

  @ApiProperty({
    enum: ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
  })
  status!: string;

  @ApiProperty({
    type: String,
    description:
      'Authoritative Payment.amountMinor in integer minor units. Never client-supplied.',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1700',
  })
  amountMinor!: string;

  @ApiProperty({ example: 'DZD' })
  currency!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Configured provider name for ELECTRONIC Payments. Never a secret or checkout URL.',
  })
  provider!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class CustomerPaymentInitiateResponseDto extends CustomerPaymentResponseDto {
  @ApiProperty({
    description:
      'PaymentTransaction id for this provider attempt. Distinct from paymentId.',
  })
  attemptId!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Provider-returned checkout URL for this attempt. Not returned from ordinary Payment GET.',
  })
  checkoutUrl!: string | null;
}

export class PaymentWebhookAcceptedDto {
  @ApiProperty({ example: true })
  accepted!: true;
}
