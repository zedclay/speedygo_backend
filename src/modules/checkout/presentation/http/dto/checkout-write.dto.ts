import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class PreviewCheckoutDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Owned Customer Address id. Server loads persisted coordinates and addressText. Client latitude, longitude, addressText, deliveryFee, pricingRuleId, deliveryZoneId, paymentMethod, tax, tip, and promo fields are not accepted.',
  })
  @IsUUID()
  addressId!: string;
}
