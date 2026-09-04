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

  @ApiProperty({
    description:
      'Application vocabulary: BUSINESS_IDENTITY, BUSINESS_REGISTRATION, SUPPORTING_DOCUMENT.',
  })
  type!: string;

  @ApiProperty({
    description: 'Application vocabulary: PENDING, SUBMITTED.',
  })
  status!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  expiryDate!: string | null;
}

export class MerchantEvidenceChecklistItemDto {
  @ApiProperty()
  type!: string;

  @ApiProperty()
  required!: boolean;

  @ApiProperty()
  present!: boolean;

  @ApiProperty()
  complete!: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  status!: string | null;

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

  @ApiProperty({
    description:
      'Derived server readiness for verification submission: profile + required evidence valid. Not client-writable.',
  })
  verificationReady!: boolean;

  @ApiProperty({
    description:
      'Derived: required documents are formally SUBMITTED. Distinguishes incomplete PENDING_REVIEW Merchants from review-ready packages.',
  })
  verificationSubmitted!: boolean;

  @ApiProperty({
    description:
      'Derived: ACTIVE Merchant with required evidence missing or expired. Does not auto-suspend. Future compliance may act.',
  })
  verificationAttentionRequired!: boolean;

  @ApiProperty({ type: MerchantProfileResponseDto })
  merchant!: MerchantProfileResponseDto;

  @ApiProperty({ type: [MerchantBranchResponseDto] })
  branches!: MerchantBranchResponseDto[];

  @ApiProperty({
    type: [MerchantDocumentResponseDto],
    description:
      'OWNER only. Read-only summaries. fileUrl / storage keys are never exposed. Metadata-only registration in this foundation.',
  })
  documents!: MerchantDocumentResponseDto[];

  @ApiProperty({
    type: [MerchantEvidenceChecklistItemDto],
    description:
      'OWNER full detail only. MANAGER and STAFF receive empty checklist (status/readiness flags only).',
  })
  evidenceChecklist!: MerchantEvidenceChecklistItemDto[];
}

export class MerchantVerificationPackageResponseDto {
  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  verifiedAt!: string | null;

  @ApiProperty()
  verificationReady!: boolean;

  @ApiProperty()
  verificationSubmitted!: boolean;

  @ApiProperty()
  verificationAttentionRequired!: boolean;

  @ApiProperty()
  evidenceEditable!: boolean;

  @ApiProperty({ type: [MerchantEvidenceChecklistItemDto] })
  evidenceChecklist!: MerchantEvidenceChecklistItemDto[];

  @ApiProperty({ type: [MerchantDocumentResponseDto] })
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
