import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CART_QUANTITY_MAX } from '../../../domain/cart.policy';

export class AddCartItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({
    minimum: 1,
    maximum: CART_QUANTITY_MAX,
    description: 'Positive integer. API protection cap is 99.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CART_QUANTITY_MAX)
  quantity!: number;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Catalog ProductOption ids. Validated against live OptionGroups, then persisted as CartItemOption rows. Client prices are ignored.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  optionIds?: string[];
}

export class UpdateCartItemDto {
  @ApiProperty({
    minimum: 1,
    maximum: CART_QUANTITY_MAX,
    description: 'Positive integer. API protection cap is 99.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CART_QUANTITY_MAX)
  quantity!: number;

  @ApiPropertyOptional({
    type: [String],
    description:
      'When present, replaces the CartItem option selection atomically after full validation. Omit to keep the current selection.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  optionIds?: string[];
}
