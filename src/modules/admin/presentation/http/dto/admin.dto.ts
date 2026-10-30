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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { TransformMoneyInputToMinorInt } from '../../../../../common/money/money-input.transform';
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

/** Admin order list — additive customer/merchant scoping (filters applied before pagination). */
export class AdminOrderListQueryDto extends AdminStatusListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Scopes to all branches of this merchant',
  })
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  merchantBranchId?: string;

  @ApiPropertyOptional({
    description: 'Inclusive lower bound on Order.createdAt (ISO-8601)',
  })
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({
    description: 'Exclusive upper bound on Order.createdAt (ISO-8601)',
  })
  @IsOptional()
  @IsISO8601()
  createdTo?: string;
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

const ADMIN_COD_DRIVER_RECONCILIATION_STATUSES = [
  'RECONCILED',
  'OUTSTANDING',
  'PARTIAL',
  'DISCREPANCY',
] as const;

export class AdminCodDriverSummaryListQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ description: 'Driver name or id search' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;

  @ApiPropertyOptional({ enum: ADMIN_COD_DRIVER_RECONCILIATION_STATUSES })
  @IsOptional()
  @IsIn([...ADMIN_COD_DRIVER_RECONCILIATION_STATUSES])
  reconciliationStatus?: (typeof ADMIN_COD_DRIVER_RECONCILIATION_STATUSES)[number];
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

  @ApiPropertyOptional({
    description: 'minor-v1 only: refund amount in integer centimes',
    minimum: 1,
  })
  @ValidateIf((o) => o.amount === undefined || o.amount === null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor?: number;

  @ApiPropertyOptional({
    description: 'dzd-v2 only: refund amount as DZD majors e.g. "6.50"',
    example: '6.50',
  })
  @ValidateIf((o) => o.amountMinor === undefined || o.amountMinor === null)
  @IsOptional()
  @IsString()
  amount?: string;

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
  @ApiPropertyOptional({
    description: 'v1 only: confirmed amount in integer centimes',
    example: 65000,
    minimum: 0,
  })
  @ValidateIf(
    (o) => o.confirmedAmount === undefined || o.confirmedAmount === null,
  )
  @TransformMoneyInputToMinorInt()
  @IsInt()
  @Min(0)
  confirmedAmountMinor?: number;

  @ApiPropertyOptional({
    description: 'dzd-v2 only: confirmed DZD majors string e.g. "650.00"',
    example: '650.00',
  })
  @ValidateIf(
    (o) =>
      o.confirmedAmountMinor === undefined || o.confirmedAmountMinor === null,
  )
  @IsOptional()
  @IsString()
  confirmedAmount?: string;
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

  @ApiPropertyOptional({
    description: 'minor-v1 only: merchant liability in integer centimes',
  })
  @ValidateIf(
    (o) => o.merchantLiability === undefined || o.merchantLiability === null,
  )
  @Type(() => Number)
  @IsInt()
  merchantLiabilityMinor?: number;

  @ApiPropertyOptional({
    description: 'dzd-v2 only: merchant liability as DZD majors e.g. "10.00"',
    example: '10.00',
  })
  @ValidateIf(
    (o) =>
      o.merchantLiabilityMinor === undefined ||
      o.merchantLiabilityMinor === null,
  )
  @IsOptional()
  @IsString()
  merchantLiability?: string;
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

  @ApiPropertyOptional({
    description:
      'RATE_BPS: integer basis points (both contracts). FIXED: minor-v1 integer centimes. dzd-v2 FIXED uses valueAmount instead.',
  })
  @ValidateIf((o) => o.valueAmount === undefined || o.valueAmount === null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  value?: number;

  @ApiPropertyOptional({
    description:
      'dzd-v2 FIXED_* only: DZD majors string e.g. "10.00". Rejected on RATE_BPS.',
    example: '10.00',
  })
  @IsOptional()
  @IsString()
  valueAmount?: string;

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

export class UpdateAdminPromotionValueDto {
  @ApiPropertyOptional({
    description:
      'RATE_BPS: integer basis points. FIXED minor-v1: integer centimes. dzd-v2 FIXED uses valueAmount instead.',
  })
  @ValidateIf((o) => o.valueAmount === undefined || o.valueAmount === null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  value?: number;

  @ApiPropertyOptional({
    description:
      'dzd-v2 FIXED_* only: DZD majors string e.g. "10.00". Rejected on RATE_BPS.',
    example: '10.00',
  })
  @IsOptional()
  @IsString()
  valueAmount?: string;
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

/** Admin Order Operations v1.0 — offer-only assign. */
export class AdminAssignOfferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  driverId!: string;

  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reason!: string;
}

/** Admin Order Operations v1.0 — early-window cancel. */
export class AdminCancelOrderDto {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reason!: string;
}
