import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  ADMIN_LIST_MAX_OFFSET,
} from '../../../domain/admin.types';
import {
  MERCHANT_DOCUMENT_TYPES,
  VERIFICATION_APPLICATION_ISSUE_CODES,
  VERIFICATION_DOCUMENT_ISSUE_CODES,
  VERIFICATION_ISSUE_MESSAGE_MAX_LENGTH,
  VERIFICATION_ISSUE_SCOPES,
  VERIFICATION_ISSUES_MAX_COUNT,
} from '../../../../merchants/domain/merchant.policy';
import { PROMOTION_TYPES_V1 } from '../../../../promotions/domain/promotion.types';
import {
  REFUND_METHOD_MANUAL_COD,
  REFUND_METHOD_MANUAL_OTHER,
} from '../../../../refunds/domain/refund.types';

/** Empty body — forbidNonWhitelisted rejects spoofed adminId / reason fields. */
export class AdminEmptyBodyDto {}

export class AdminRejectMerchantIssueDto {
  @ApiProperty({ enum: VERIFICATION_ISSUE_SCOPES })
  @IsIn([...VERIFICATION_ISSUE_SCOPES])
  scope!: string;

  @ApiProperty({
    description: `APPLICATION: ${VERIFICATION_APPLICATION_ISSUE_CODES.join(', ')}. DOCUMENT: ${VERIFICATION_DOCUMENT_ISSUE_CODES.join(', ')}.`,
  })
  @IsString()
  @MaxLength(64)
  code!: string;

  @ApiProperty({
    maxLength: VERIFICATION_ISSUE_MESSAGE_MAX_LENGTH,
    description: 'Public French message shown to the Merchant OWNER.',
  })
  @IsString()
  @MaxLength(VERIFICATION_ISSUE_MESSAGE_MAX_LENGTH * 2)
  messageFr!: string;

  @ApiPropertyOptional({
    enum: MERCHANT_DOCUMENT_TYPES,
    description: 'Required when scope is DOCUMENT; forbidden otherwise.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  documentType?: string;
}

export class AdminRejectMerchantVerificationDto {
  @ApiProperty({
    type: [AdminRejectMerchantIssueDto],
    maxItems: VERIFICATION_ISSUES_MAX_COUNT,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(VERIFICATION_ISSUES_MAX_COUNT)
  @ValidateNested({ each: true })
  @Type(() => AdminRejectMerchantIssueDto)
  issues!: AdminRejectMerchantIssueDto[];
}

export class AdminListQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: ADMIN_LIST_MAX_LIMIT,
    default: ADMIN_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: ADMIN_LIST_MAX_OFFSET,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ADMIN_LIST_MAX_OFFSET)
  offset?: number;
}

export class AdminStatusListQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;
}

export class AdminDriverListQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  verificationStatus?: string;
}

export class AdminRefundListQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class AdminSettlementListQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;
}

export class AdminPromotionListQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;
}

export class AdminCodRemittanceListQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;
}

export class AdminAuditListQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  adminId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  targetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  createdTo?: string;
}

export class AdminLedgerListQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;

  @ApiPropertyOptional({ enum: ['DEBIT', 'CREDIT'] })
  @IsOptional()
  @IsIn(['DEBIT', 'CREDIT'])
  direction?: 'DEBIT' | 'CREDIT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reference?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  createdTo?: string;
}

/** Body adminId is intentionally absent — forbidNonWhitelisted rejects spoof. */
export class CreateAdminRefundDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiProperty({
    enum: [REFUND_METHOD_MANUAL_COD, REFUND_METHOD_MANUAL_OTHER],
    description: 'ORIGINAL_PAYMENT is not accepted on Admin HTTP.',
  })
  @IsIn([REFUND_METHOD_MANUAL_COD, REFUND_METHOD_MANUAL_OTHER])
  method!: typeof REFUND_METHOD_MANUAL_COD | typeof REFUND_METHOD_MANUAL_OTHER;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reason!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNote?: string;
}

export class AdminRefundNoteDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNote?: string;
}

export class ConfirmCodRemittanceDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  confirmedAmountMinor!: number;
}

export class OpenSettlementDraftDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  merchantId!: string;

  @ApiProperty()
  @IsISO8601()
  periodStart!: string;

  @ApiProperty()
  @IsISO8601()
  periodEnd!: string;
}

export class AttachSettlementRefundLiabilityDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  refundId!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  merchantLiabilityMinor!: number;
}

export class CreateAdminPromotionDto {
  @ApiProperty({ maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @ApiProperty({ enum: PROMOTION_TYPES_V1 })
  @IsIn([...PROMOTION_TYPES_V1])
  type!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  value!: number;

  @ApiProperty()
  @IsISO8601()
  startsAt!: string;

  @ApiProperty()
  @IsISO8601()
  endsAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      'When true, the offer may appear on Customer discovery if it is also effective. Defaults to false.',
  })
  @IsOptional()
  @IsBoolean()
  customerDiscoverable?: boolean;

  @ApiPropertyOptional({
    maxLength: 64,
    nullable: true,
    description:
      'Optional Customer-facing presentation label. Not a discount rule.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  customerLabel?: string | null;
}

export class UpdateAdminPromotionPresentationDto {
  @ApiPropertyOptional({
    maxLength: 64,
    nullable: true,
    description:
      'Optional Customer-facing presentation label. Not a discount rule.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  customerLabel?: string | null;
}
