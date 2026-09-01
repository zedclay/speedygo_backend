import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MerchantProfileResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description: 'Server-managed unique public reference. Not client-writable.',
  })
  publicReference!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    description:
      'Application vocabulary: PENDING_REVIEW, ACTIVE, REJECTED, SUSPENDED. Created as PENDING_REVIEW. Merchant-side APIs cannot write this field. ACTIVE is established only by future Admin approval together with verifiedAt.',
  })
  status!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Null until Admin approval. Merchant-side APIs cannot write this field. Expected non-null when status is ACTIVE.',
  })
  verifiedAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class MerchantBranchResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  phone!: string;

  @ApiProperty()
  addressText!: string;

  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;

  @ApiProperty({
    description:
      'Application vocabulary: ACTIVE, INACTIVE, SUSPENDED. Created as ACTIVE. Server-managed in this foundation; not client-writable. This is not opening-hours state — ACTIVE does not mean the store is open at this moment.',
  })
  operationalStatus!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class MerchantDocumentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  expiryDate!: string | null;
}

export class MerchantMembershipResponseDto {
  @ApiProperty()
  merchantId!: string;

  @ApiProperty({
    description:
      'Application vocabulary: OWNER, MANAGER, STAFF. The founding member is OWNER. Unknown stored values fail closed and never receive OWNER or MANAGER capabilities.',
  })
  role!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({
    description: 'Derived: merchant name is non-empty after trim.',
  })
  profileComplete!: boolean;

  @ApiProperty({
    description: 'Derived: the Merchant has at least one Branch.',
  })
  hasBranch!: boolean;

  @ApiProperty({
    description:
      'Derived: at least one Branch has operationalStatus ACTIVE. Independent of Catalog. Not opening-hours state.',
  })
  branchReady!: boolean;

  @ApiProperty({
    description:
      'Derived: status is ACTIVE and verifiedAt is set. PENDING_REVIEW, REJECTED, and SUSPENDED are never approved.',
  })
  approved!: boolean;

  @ApiProperty({
    description:
      'Derived: profileComplete AND approved AND branchReady. PENDING_REVIEW, REJECTED, and SUSPENDED are never operationalReady.',
  })
  operationalReady!: boolean;

  @ApiProperty({ type: MerchantProfileResponseDto })
  merchant!: MerchantProfileResponseDto;

  @ApiProperty({ type: [MerchantBranchResponseDto] })
  branches!: MerchantBranchResponseDto[];

  @ApiProperty({
    type: [MerchantDocumentResponseDto],
    description:
      'Read-only summaries. fileUrl is not exposed. No upload in this foundation.',
  })
  documents!: MerchantDocumentResponseDto[];
}

export class MerchantMeResponseDto {
  @ApiProperty({
    description:
      'False when the authenticated Account has no MerchantMember rows. This is not an error. An Account may belong to many Merchants.',
  })
  merchantMembershipExists!: boolean;

  @ApiProperty({ type: [MerchantMembershipResponseDto] })
  memberships!: MerchantMembershipResponseDto[];
}

export class MerchantBranchListResponseDto {
  @ApiProperty({ type: [MerchantBranchResponseDto] })
  branches!: MerchantBranchResponseDto[];
}

export class MerchantDeletedResponseDto {
  @ApiProperty()
  deleted!: true;
}
