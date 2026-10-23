import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
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

  @ApiPropertyOptional({
    description:
      'minor-v1: Customer-confirmed merchandise subtotal in integer centimes from Checkout Preview. Comparison-only.',
    minimum: 0,
    maximum: ORDER_EXPECTED_MINOR_MAX,
    example: 1200,
  })
  @ValidateIf(
    (o) =>
      o.expectedMerchandiseSubtotal === undefined ||
      o.expectedMerchandiseSubtotal === null,
  )
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ORDER_EXPECTED_MINOR_MAX)
  expectedMerchandiseSubtotalMinor?: number;

  @ApiPropertyOptional({
    description:
      'dzd-v2: Customer-confirmed merchandise subtotal as DZD majors e.g. "12.00". Comparison-only.',
    example: '12.00',
  })
  @ValidateIf(
    (o) =>
      o.expectedMerchandiseSubtotalMinor === undefined ||
      o.expectedMerchandiseSubtotalMinor === null,
  )
  @IsOptional()
  @IsString()
  expectedMerchandiseSubtotal?: string;

  @ApiPropertyOptional({
    description:
      'minor-v1: Customer-confirmed Delivery Fee in integer centimes. Comparison-only.',
    minimum: 0,
    maximum: ORDER_EXPECTED_MINOR_MAX,
    example: 500,
  })
  @ValidateIf(
    (o) =>
      o.expectedDeliveryFee === undefined || o.expectedDeliveryFee === null,
  )
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ORDER_EXPECTED_MINOR_MAX)
  expectedDeliveryFeeMinor?: number;

  @ApiPropertyOptional({
    description: 'dzd-v2: Customer-confirmed Delivery Fee as DZD majors e.g. "5.00".',
    example: '5.00',
  })
  @ValidateIf(
    (o) =>
      o.expectedDeliveryFeeMinor === undefined ||
      o.expectedDeliveryFeeMinor === null,
  )
  @IsOptional()
  @IsString()
  expectedDeliveryFee?: string;

  @ApiPropertyOptional({
    description:
      'minor-v1: Customer-confirmed total in integer centimes (maps to customerPayableMinor for comparison only).',
    minimum: 0,
    maximum: ORDER_EXPECTED_MINOR_MAX,
    example: 1700,
  })
  @ValidateIf(
    (o) =>
      o.expectedCustomerTotal === undefined || o.expectedCustomerTotal === null,
  )
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ORDER_EXPECTED_MINOR_MAX)
  expectedCustomerTotalMinor?: number;

  @ApiPropertyOptional({
    description:
      'dzd-v2: Customer-confirmed total as DZD majors e.g. "17.00". Never Payment authority.',
    example: '17.00',
  })
  @ValidateIf(
    (o) =>
      o.expectedCustomerTotalMinor === undefined ||
      o.expectedCustomerTotalMinor === null,
  )
  @IsOptional()
  @IsString()
  expectedCustomerTotal?: string;

  @ApiPropertyOptional({
    description:
      'Optional promotion code. Revalidated inside the Order transaction. If supplied and no longer eligible, Order creation fails — the discount is never silently dropped. Client discountMinor/funding fields are rejected.',
    maxLength: 64,
    example: 'SAVE10',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  promoCode?: string;
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
