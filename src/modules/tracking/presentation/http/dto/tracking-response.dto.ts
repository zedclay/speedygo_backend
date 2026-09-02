import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class DriverLocationUpdateDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  accuracyMeters?: number;
}

export class TrackingLocationDto {
  @ApiProperty()
  deliveryId!: string;

  @ApiProperty()
  assignedDriverId!: string;

  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;

  @ApiProperty()
  recordedAt!: string;

  @ApiPropertyOptional({ nullable: true, type: Number })
  accuracyMeters!: number | null;
}

export class TrackingSnapshotDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  deliveryId!: string | null;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  driverAssigned!: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  assignedDriverId!: string | null;

  @ApiProperty({ enum: ['LIVE', 'STALE', 'UNAVAILABLE', 'NO_DRIVER'] })
  status!: string;

  @ApiProperty()
  isStale!: boolean;

  @ApiPropertyOptional({ nullable: true, type: TrackingLocationDto })
  location!: TrackingLocationDto | null;
}
