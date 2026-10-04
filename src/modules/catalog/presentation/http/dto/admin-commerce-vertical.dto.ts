import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAdminCommerceVerticalDto {
  @ApiProperty({ example: 'restaurants' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  slug!: string;

  @ApiProperty({ example: 'Restaurants' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ example: 'restaurant' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  iconKey!: string;

  @ApiProperty({ example: 0, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class UpdateAdminCommerceVerticalDto {
  @ApiPropertyOptional({ example: 'Restaurants' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: 'restaurant' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  iconKey?: string;

  @ApiPropertyOptional({ example: 1, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class AssignCommerceVerticalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  verticalId!: string;
}

export class BindStorefrontCoverDto {
  @ApiProperty({
    description:
      'Opaque upload reference from POST .../cover/content (sg-upload:v1:...). Never a path or URL.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  uploadReference!: string;
}
