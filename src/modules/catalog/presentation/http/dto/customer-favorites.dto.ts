import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  CUSTOMER_FAVORITE_KIND_BRANCH,
  CUSTOMER_FAVORITE_KIND_PRODUCT,
} from '../../../domain/customer-favorites.types';

export class CustomerFavoritesListQueryDto {
  @ApiPropertyOptional({
    enum: [CUSTOMER_FAVORITE_KIND_BRANCH, CUSTOMER_FAVORITE_KIND_PRODUCT],
    default: CUSTOMER_FAVORITE_KIND_BRANCH,
  })
  @IsOptional()
  @IsIn([CUSTOMER_FAVORITE_KIND_BRANCH, CUSTOMER_FAVORITE_KIND_PRODUCT])
  kind?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Owned Customer Address. Coverage is computed live against this pin using the same DeliveryZone ST_Covers rule as catalog list/search. Omitted = UNFILTERED/unknown. Does not persist on the favorite row. Wilaya cannot substitute for the pin.',
  })
  @IsOptional()
  @IsUUID()
  addressId?: string;
}
