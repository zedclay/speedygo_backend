import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN } from '../../../../../common/money/money-minor';
import { CartItemResponseDto } from '../../../../cart/presentation/http/dto/cart-response.dto';

export class CheckoutCartSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  itemCount!: number;

  @ApiProperty({
    type: String,
    description: 'Live merchandise subtotal in integer minor units.',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1200',
  })
  merchandiseSubtotalMinor!: string;

  @ApiProperty({ type: [CartItemResponseDto] })
  items!: CartItemResponseDto[];
}

export class CheckoutAddressSnapshotCandidateDto {
  @ApiProperty({
    description:
      'Preview snapshot candidate from the persisted Address. Not OrderDeliveryAddressSnapshot. Future Order creation persists the snapshot atomically.',
  })
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  addressText!: string;

  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;
}

export class CheckoutDeliveryZoneSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class CheckoutPricingSummaryDto {
  @ApiProperty()
  ruleId!: string;

  @ApiProperty()
  ruleName!: string;

  @ApiProperty({ enum: ['DAY', 'NIGHT', 'CUSTOM'] })
  timeBand!: string;

  @ApiProperty({
    example: 'Africa/Algiers',
    description:
      'Pricing local time is evaluated in Africa/Algiers. timeBand is metadata only; applicability uses startLocalTime/endLocalTime (both null = all-day). Delivery Fee is not reserved.',
  })
  timezone!: string;
}

export class CheckoutPreviewResponseDto {
  @ApiProperty({
    description:
      'True only on this success body. Blocking Checkout failures are HTTP errors, not checkoutReady=false.',
  })
  checkoutReady!: true;

  @ApiProperty({
    type: [String],
    example: ['PRICE_CHANGED'],
    description:
      'Non-blocking warnings. PRICE_CHANGED means CartItem.unitPriceMinor differed from live Catalog; Checkout remains ready.',
  })
  warnings!: string[];

  @ApiProperty({ type: CheckoutCartSummaryDto })
  cart!: CheckoutCartSummaryDto;

  @ApiProperty({ type: CheckoutAddressSnapshotCandidateDto })
  address!: CheckoutAddressSnapshotCandidateDto;

  @ApiProperty({ type: CheckoutDeliveryZoneSummaryDto })
  deliveryZone!: CheckoutDeliveryZoneSummaryDto;

  @ApiProperty({ type: CheckoutPricingSummaryDto })
  pricing!: CheckoutPricingSummaryDto;

  @ApiProperty({
    type: String,
    description:
      'Live merchandise subtotal (gross) in integer minor units. Not reduced by promotions.',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1200',
  })
  merchandiseSubtotalMinor!: string;

  @ApiProperty({
    type: String,
    description:
      'customerDeliveryFeeMinor from the uniquely resolved DeliveryPricingRule. Integer minor units. Flat fee; not distance-based. Merchandise promotions do not alter delivery fee.',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '500',
  })
  deliveryFeeMinor!: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Customer-facing promotion discount in integer minor units when a valid promoCode was supplied. Omitted when no promotion applies.',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '100',
    nullable: true,
  })
  discountMinor?: string | null;

  @ApiPropertyOptional({
    description:
      'Normalized promotion code when a valid promoCode was applied. Omitted when no promotion applies.',
    nullable: true,
  })
  promoCode?: string | null;

  @ApiProperty({
    type: String,
    description:
      'merchandiseSubtotalMinor − discountMinor + deliveryFeeMinor. No taxes or tips. discountMinor is 0 when no promotion applies.',
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    example: '1700',
  })
  customerTotalMinor!: string;
}
