import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class PreviewCheckoutDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Owned Customer Address id. Server loads persisted coordinates and addressText. Client latitude, longitude, addressText, deliveryFee, pricingRuleId, deliveryZoneId, paymentMethod, tax, tip, discountMinor, and funding fields are not accepted.',
  })
  @IsUUID()
  addressId!: string;

  @ApiPropertyOptional({
    description:
      'Optional promotion code. Preview evaluates eligibility without consuming a redemption. Invalid/ineligible codes fail the preview. Client discount amounts are rejected.',
    maxLength: 64,
    example: 'SAVE10',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  promoCode?: string;
}
