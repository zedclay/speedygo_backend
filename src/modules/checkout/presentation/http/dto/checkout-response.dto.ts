import { ApiProperty } from '@nestjs/swagger';
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
    description: 'Live merchandise subtotal in integer minor units.',
  })
  merchandiseSubtotalMinor!: number;

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
    description: 'Live merchandise subtotal in integer minor units.',
  })
  merchandiseSubtotalMinor!: number;

  @ApiProperty({
    description:
      'customerDeliveryFeeMinor from the uniquely resolved DeliveryPricingRule. Integer minor units. Flat fee; not distance-based.',
  })
  deliveryFeeMinor!: number;

  @ApiProperty({
    description:
      'merchandiseSubtotalMinor + deliveryFeeMinor. No promotions, taxes, or tips.',
  })
  customerTotalMinor!: number;
}
