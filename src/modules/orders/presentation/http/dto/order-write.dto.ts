import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import {
  ORDER_EXPECTED_MINOR_MAX,
  ORDER_LIST_DEFAULT_LIMIT,
  ORDER_LIST_MAX_LIMIT,
  ORDER_LIST_MAX_OFFSET,
} from '../../../domain/order.policy';

export class CreateOrderDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Owned Customer Address id. Server loads persisted coordinates and addressText. Client totals, zone ids, pricingRuleId, cartId, and Catalog prices are rejected.',
  })
  @IsUUID()
  addressId!: string;

  @ApiProperty({
    description:
      'Customer payment-method choice at Order creation. Frozen v1.0 values: COD or ELECTRONIC. Persisted on Payment.method with status PENDING. Does not create PaymentTransaction or collect COD.',
    enum: ['COD', 'ELECTRONIC'],
  })
  @IsString()
  paymentMethod!: string;

  @ApiProperty({
    description:
      'Customer-confirmed merchandise subtotal from the latest Checkout Preview (merchandiseSubtotalMinor). Comparison-only. The Backend recalculates live Product and Option prices and never uses this as price authority.',
    minimum: 0,
    maximum: ORDER_EXPECTED_MINOR_MAX,
    example: 1200,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ORDER_EXPECTED_MINOR_MAX)
  expectedMerchandiseSubtotalMinor!: number;

  @ApiProperty({
    description:
      'Customer-confirmed Delivery Fee from the latest Checkout Preview (deliveryFeeMinor). Comparison-only. Checkout Preview does not reserve the fee. The Backend recalculates the live DeliveryPricingRule.',
    minimum: 0,
    maximum: ORDER_EXPECTED_MINOR_MAX,
    example: 500,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ORDER_EXPECTED_MINOR_MAX)
  expectedDeliveryFeeMinor!: number;

  @ApiProperty({
    description:
      'Customer-confirmed total from the latest Checkout Preview (customerTotalMinor). Maps to internal customerPayableMinor for comparison only. Must equal expectedMerchandiseSubtotalMinor + expectedDeliveryFeeMinor. Never used as Payment.amountMinor authority.',
    minimum: 0,
    maximum: ORDER_EXPECTED_MINOR_MAX,
    example: 1700,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ORDER_EXPECTED_MINOR_MAX)
  expectedCustomerTotalMinor!: number;
}

export class ListOrdersQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: ORDER_LIST_MAX_LIMIT,
    default: ORDER_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ORDER_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: ORDER_LIST_MAX_OFFSET,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ORDER_LIST_MAX_OFFSET)
  offset?: number;
}
