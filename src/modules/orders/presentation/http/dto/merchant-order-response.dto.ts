import { ApiProperty } from '@nestjs/swagger';
import {
  OrderAddressSnapshotResponseDto,
  OrderItemResponseDto,
} from './order-response.dto';

export class MerchantOrderFinancialResponseDto {
  @ApiProperty({ example: 'DZD' })
  currency!: string;

  @ApiProperty()
  grossMerchandiseSubtotalMinor!: number;

  @ApiProperty()
  merchantDiscountMinor!: number;

  @ApiProperty()
  merchantCommissionRateBps!: number;

  @ApiProperty()
  merchantCommissionAmountMinor!: number;

  @ApiProperty()
  merchantNetAmountMinor!: number;

  @ApiProperty({
    description:
      'Customer Delivery Fee snapshotted at Order creation. Not Merchant revenue.',
  })
  deliveryFeeMinor!: number;
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

  @ApiProperty({ type: MerchantOrderFinancialResponseDto })
  financial!: MerchantOrderFinancialResponseDto;
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
    description:
      'Present after pre-accept Merchant rejection. Cancellation is not a Refund.',
  })
  cancellation!: { reason: string; cancelledAt: string } | null;
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
