import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DriverProfileResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ example: 'UNVERIFIED' })
  verificationStatus!: string;

  @ApiProperty({ nullable: true, type: String })
  approvedAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class DriverDocumentResponseDto {
  @ApiProperty()
  type!: string;

  @ApiProperty({ nullable: true, type: String })
  expiryDate!: string | null;

  @ApiProperty({
    description:
      'Metadata row exists. fileUrl/object key is never returned. Bytes are not stored in this foundation.',
  })
  present!: boolean;
}

export class DriverVehicleResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  plateNumber!: string;

  @ApiProperty()
  model!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  color!: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class DriverAvailabilityResponseDto {
  @ApiProperty({ example: 'OFFLINE' })
  status!: string;

  @ApiProperty()
  offlineAfterCurrentDelivery!: boolean;

  @ApiProperty()
  updatedAt!: string;
}

export class DriverMeResponseDto {
  @ApiProperty()
  driverProfileExists!: boolean;

  @ApiProperty()
  profileComplete!: boolean;

  @ApiProperty()
  identityDocumentComplete!: boolean;

  @ApiProperty()
  drivingLicenseComplete!: boolean;

  @ApiProperty()
  vehicleComplete!: boolean;

  @ApiProperty()
  verificationSubmitted!: boolean;

  @ApiProperty()
  verificationApproved!: boolean;

  @ApiProperty()
  operationalReady!: boolean;

  @ApiProperty({
    description:
      'Base database Matching gate: operationalReady + ONLINE. Does not imply a fresh location or geo-pool membership. No GEO/distance in this foundation.',
  })
  matchingEligible!: boolean;

  @ApiPropertyOptional({ type: DriverProfileResponseDto, nullable: true })
  profile!: DriverProfileResponseDto | null;

  @ApiProperty({ type: [DriverDocumentResponseDto] })
  documents!: DriverDocumentResponseDto[];

  @ApiProperty({ type: [DriverVehicleResponseDto] })
  vehicles!: DriverVehicleResponseDto[];

  @ApiPropertyOptional({ type: DriverAvailabilityResponseDto, nullable: true })
  availability!: DriverAvailabilityResponseDto | null;
}
