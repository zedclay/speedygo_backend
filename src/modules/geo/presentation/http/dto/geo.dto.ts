import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CommuneListQueryDto {
  @ApiPropertyOptional({
    description: 'Optional French/Arabic name search (case-insensitive)',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class WilayaResponseDto {
  @ApiProperty({ example: '16', description: 'Official two-digit wilaya code' })
  code!: string;

  @ApiProperty({ example: 'Alger' })
  nameFr!: string;

  @ApiProperty({ example: 'الجزائر' })
  nameAr!: string;
}

export class CommuneResponseDto {
  @ApiProperty({
    example: 556,
    description: 'SpeedyGo catalogue id (not an ONS code)',
  })
  id!: number;

  @ApiProperty({ example: '16' })
  wilayaCode!: string;

  @ApiProperty({ example: 'Alger Centre' })
  nameFr!: string;

  @ApiProperty({ example: 'الجزائر الوسطى' })
  nameAr!: string;

  @ApiProperty({ type: [String], example: [] })
  aliasesFr!: string[];
}

export class WilayaListResponseDto {
  @ApiProperty({ type: [WilayaResponseDto] })
  wilayas!: WilayaResponseDto[];
}

export class CommuneListResponseDto {
  @ApiProperty({ type: [CommuneResponseDto] })
  communes!: CommuneResponseDto[];
}

export class PlaceAutocompleteQueryDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  q!: string;

  @ApiPropertyOptional({ enum: ['fr', 'ar'] })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({
    description:
      'Places Autocomplete (New) session token (UUID v4). Same token must be sent to Place Details, then discarded.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(128)
  sessionToken?: string;
}

export class PlaceSuggestionDto {
  @ApiProperty()
  placeId!: string;

  @ApiProperty()
  text!: string;
}

export class PlaceAutocompleteResponseDto {
  @ApiProperty()
  configured!: boolean;

  @ApiProperty({ type: [PlaceSuggestionDto] })
  suggestions!: PlaceSuggestionDto[];
}

export class ReverseGeocodeQueryDto {
  @ApiProperty({ example: 35.1939 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: -0.6417 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional({ enum: ['fr', 'ar'] })
  @IsOptional()
  @IsString()
  language?: string;
}

export class ReverseGeocodeResponseDto {
  @ApiProperty()
  configured!: boolean;

  @ApiPropertyOptional({ nullable: true })
  formattedAddress!: string | null;
}

export class PlaceDetailsQueryDto {
  @ApiProperty({ maxLength: 256 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  placeId!: string;

  @ApiPropertyOptional({ enum: ['fr', 'ar'] })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({
    description:
      'Same Autocomplete (New) session token as the suggestions request that produced this placeId.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(128)
  sessionToken?: string;
}

export class PlaceDetailsResponseDto {
  @ApiProperty()
  configured!: boolean;

  @ApiProperty()
  placeId!: string;

  @ApiPropertyOptional({ nullable: true })
  formattedAddress!: string | null;

  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;
}
