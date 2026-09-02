import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignmentOfferPickupDto {
  @ApiProperty({ description: 'Safe Merchant display name. No phone.' })
  name!: string;
}

export class AssignmentOfferResponseDto {
  @ApiProperty()
  assignmentId!: string;

  @ApiProperty()
  deliveryId!: string;

  @ApiProperty()
  orderPublicReference!: string;

  @ApiProperty({ example: 'OFFERED' })
  status!: string;

  @ApiProperty()
  offeredAt!: string;

  @ApiProperty({
    description: 'Derived from assignedAt + MATCHING_OFFER_TIMEOUT_MS',
  })
  expiresAt!: string;

  @ApiProperty({
    description: 'Frozen OrderFinancialSnapshot.driverRemunerationMinor',
  })
  driverRemunerationMinor!: number;

  @ApiProperty({ type: AssignmentOfferPickupDto })
  pickup!: AssignmentOfferPickupDto;

  @ApiProperty()
  pickupDistanceMeters!: number;

  @ApiPropertyOptional({ nullable: true, type: Number })
  deliveryDistanceMeters!: number | null;
}

export class CurrentOfferResponseDto {
  @ApiPropertyOptional({ type: AssignmentOfferResponseDto, nullable: true })
  offer!: AssignmentOfferResponseDto | null;
}

export class AcceptedAssignmentPickupDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  addressText!: string;

  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;
}

export class AcceptedAssignmentDropoffDto {
  @ApiProperty()
  addressText!: string;

  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;
}

export class AcceptedAssignmentResponseDto {
  @ApiProperty()
  assignmentId!: string;

  @ApiProperty()
  deliveryId!: string;

  @ApiProperty()
  orderPublicReference!: string;

  @ApiProperty({ example: 'ACCEPTED' })
  status!: string;

  @ApiProperty({ nullable: true, type: String })
  acceptedAt!: string | null;

  @ApiProperty()
  driverRemunerationMinor!: number;

  @ApiProperty({ type: AcceptedAssignmentPickupDto })
  pickup!: AcceptedAssignmentPickupDto;

  @ApiProperty({ type: AcceptedAssignmentDropoffDto })
  dropoff!: AcceptedAssignmentDropoffDto;
}

export class CurrentAcceptedResponseDto {
  @ApiPropertyOptional({ type: AcceptedAssignmentResponseDto, nullable: true })
  assignment!: AcceptedAssignmentResponseDto | null;
}
