import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN } from '../../../../../common/money/money-minor';
import { MERCHANT_CANCELLATION_REASON_CODES } from '../../../domain/merchant-cancellation-reason';
import {
  MERCHANT_DELIVERY_IMPACT_STATES,
  type MerchantDeliveryImpactState,
} from '../../../domain/merchant-delivery-impact';
import {
  OrderAddressSnapshotResponseDto,
  OrderItemResponseDto,
} from './order-response.dto';

export class MerchantOrderFinancialResponseDto {
  @ApiProperty({ example: 'DZD' })
  currency!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1200',
  })
  grossMerchandiseSubtotalMinor!: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Omitted (key absent, never zero) when financialAccess=ROLE_RESTRICTED (STAFF).',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '0',
  })
  merchantDiscountMinor?: string;

  @ApiPropertyOptional({
    type: Number,
    description:
      'Omitted (key absent, never zero) when financialAccess=ROLE_RESTRICTED (STAFF).',
  })
  merchantCommissionRateBps?: number;

  @ApiPropertyOptional({
    type: String,
    description:
      'Omitted (key absent, never zero) when financialAccess=ROLE_RESTRICTED (STAFF).',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '84',
  })
  merchantCommissionAmountMinor?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Omitted (key absent, never zero) when financialAccess=ROLE_RESTRICTED (STAFF).',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1116',
  })
  merchantNetAmountMinor?: string;

  @ApiProperty({
    type: String,
    description:
      'Customer Delivery Fee snapshotted at Order creation. Not Merchant revenue.',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '500',
  })
  deliveryFeeMinor!: string;
}

export class MerchantOrderPaymentResponseDto {
  @ApiProperty({ enum: ['COD', 'ELECTRONIC'] })
  method!: string;

  @ApiProperty({
    description:
      'Payment intent status. Merchant workflow does not execute payment.',
  })
  status!: string;
}

export class MerchantOrderStatusEventResponseDto {
  @ApiProperty()
  eventType!: string;

  @ApiProperty()
  actorType!: string;

  @ApiProperty({ nullable: true, type: String })
  fromStatus!: string | null;

  @ApiProperty()
  toStatus!: string;

  @ApiProperty()
  occurredAt!: string;
}

export class MerchantOrderSummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description:
      'Server-generated public reference (sgo_{uuidhex}). Not an authorization credential.',
  })
  publicReference!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  fulfillmentStatus!: string;

  @ApiProperty()
  merchantBranchId!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ nullable: true, type: String })
  confirmedAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Live CustomerProfile.fullName for fulfillment display. Not an Order snapshot. Account phone is not exposed.',
  })
  customerFullName!: string | null;

  @ApiProperty({ type: MerchantOrderPaymentResponseDto })
  payment!: MerchantOrderPaymentResponseDto;

  @ApiProperty({
    enum: ['GRANTED', 'ROLE_RESTRICTED'],
    description:
      'Server-side Merchant financial visibility for the caller role. GRANTED: OWNER/MANAGER. ROLE_RESTRICTED: STAFF; commission, merchant net and merchant discount keys are omitted from financial.',
  })
  financialAccess!: 'GRANTED' | 'ROLE_RESTRICTED';

  @ApiProperty({ type: MerchantOrderFinancialResponseDto })
  financial!: MerchantOrderFinancialResponseDto;

  @ApiProperty({ nullable: true, type: Number })
  preparationMinutes!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  originalPreparationMinutes!: number | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Server-authoritative prep ready instant. Distinct from Delivery driver ETA.',
  })
  estimatedReadyAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  originalEstimatedReadyAt!: string | null;

  @ApiProperty({
    description: '0 = no estimate; optimistic concurrency for estimate updates',
  })
  preparationEstimateVersion!: number;

  @ApiProperty({
    description:
      'Derived at response time: now > estimatedReadyAt while still ACCEPTED/PREPARING. Never auto-READY.',
  })
  isPreparationLate!: boolean;
}

export class MerchantOrderCancellationResponseDto {
  @ApiProperty({ description: 'Free-text rejection details.' })
  reason!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    enum: MERCHANT_CANCELLATION_REASON_CODES,
    description:
      'Structured Merchant reject code; null for legacy or non-Merchant cancellations.',
  })
  reasonCode!: string | null;

  @ApiProperty()
  cancelledAt!: string;
}

export class MerchantPreparationRevisionResponseDto {
  @ApiProperty()
  revisionNumber!: number;

  @ApiProperty()
  addMinutes!: number;

  @ApiProperty({ nullable: true, type: String })
  reason!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class MerchantDeliveryImpactResponseDto {
  @ApiProperty({
    enum: MERCHANT_DELIVERY_IMPACT_STATES,
    description:
      'Classification from persisted facts only. Never a delivery-delay duration.',
  })
  state!: MerchantDeliveryImpactState;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Persisted Delivery.status, or null when no Delivery exists.',
  })
  deliveryStatus!: string | null;
}

export class MerchantOrderDetailResponseDto extends MerchantOrderSummaryResponseDto {
  @ApiProperty({ type: [OrderItemResponseDto] })
  items!: OrderItemResponseDto[];

  @ApiProperty({ type: OrderAddressSnapshotResponseDto })
  deliveryAddress!: OrderAddressSnapshotResponseDto;

  @ApiProperty({ type: [MerchantOrderStatusEventResponseDto] })
  statusHistory!: MerchantOrderStatusEventResponseDto[];

  @ApiProperty({
    nullable: true,
    type: MerchantOrderCancellationResponseDto,
    description:
      'Present after pre-accept Merchant rejection. Cancellation is not a Refund.',
  })
  cancellation!: MerchantOrderCancellationResponseDto | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Whole minutes past estimatedReadyAt when isPreparationLate; otherwise null.',
  })
  delayMinutes!: number | null;

  @ApiProperty({
    nullable: true,
    type: MerchantPreparationRevisionResponseDto,
    description: 'Latest preparation estimate revision, or null if none.',
  })
  latestPreparationRevision!: MerchantPreparationRevisionResponseDto | null;

  @ApiProperty({
    nullable: true,
    type: MerchantDeliveryImpactResponseDto,
    description:
      'How preparation relates to the Delivery. Prep estimatedReadyAt is distinct from Delivery estimatedArrivalAt.',
  })
  deliveryImpact!: MerchantDeliveryImpactResponseDto | null;
}

export class MerchantOrderListResponseDto {
  @ApiProperty({ type: [MerchantOrderSummaryResponseDto] })
  items!: MerchantOrderSummaryResponseDto[];

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty()
  total!: number;
}
