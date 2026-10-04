import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

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
