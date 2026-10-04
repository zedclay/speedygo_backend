import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import {
  COVER_MAX_BYTES,
  LOGO_MAX_BYTES,
} from '../../../../infrastructure/storage/domain/cover-media.policy';
import { STORAGE_MAX_BYTES } from '../../../../infrastructure/storage/domain/content-validation';
import { storageMalformedMultipart } from '../../../../infrastructure/storage/domain/storage.errors';
import { MerchantBranchCoverService } from '../../application/merchant-branch-cover.service';
import { MerchantBranchLogoService } from '../../application/merchant-branch-logo.service';
import { MerchantBranchService } from '../../application/merchant-branch.service';
import { MerchantProfileService } from '../../application/merchant-profile.service';
import { MerchantVerificationService } from '../../application/merchant-verification.service';
import { OpeningHoursService } from '../../application/opening-hours.service';
import { OpeningHoursExceptionService } from '../../application/opening-hours-exception.service';
import { BranchAvailabilityService } from '../../application/branch-availability.service';
import { MERCHANT_ERROR_CODES } from '../../domain/merchant.errors';
import { OPENING_HOURS_ERROR_CODES } from '../../domain/opening-hours.errors';
import { OPENING_HOURS_EXCEPTION_ERROR_CODES } from '../../domain/opening-hours-exception.errors';
import { AVAILABILITY_ERROR_CODES } from '../../domain/branch-availability.errors';
import { MERCHANT_DOCUMENT_TYPES } from '../../domain/merchant.policy';
import {
  MerchantCurrentLegalResponseDto,
  MerchantBranchListResponseDto,
  MerchantBranchResponseDto,
  MerchantDeletedResponseDto,
  MerchantMeResponseDto,
  MerchantMembershipResponseDto,
  MerchantVerificationPackageResponseDto,
} from './dto/merchant-response.dto';
import {
  BindMerchantBranchCoverDto,
  BindMerchantBranchLogoDto,
  CreateMerchantBranchDto,
  CreateMerchantProfileDto,
  SubmitMerchantVerificationDto,
  UpdateMerchantBranchDto,
  UpdateMerchantProfileDto,
  UpsertMerchantDocumentDto,
} from './dto/merchant-write.dto';
import {
  OpeningHoursResponseDto,
  PutOpeningHoursDto,
} from './dto/opening-hours.dto';
import {
  BranchAvailabilityResponseDto,
  PutBranchAvailabilityDto,
} from './dto/branch-availability.dto';
import {
  OpeningHoursExceptionDeletedResponseDto,
  OpeningHoursExceptionListResponseDto,
  OpeningHoursExceptionResponseDto,
  PutOpeningHoursExceptionDto,
} from './dto/opening-hours-exception.dto';

@ApiTags('merchant')
@ApiBearerAuth()
@Controller('merchant')
export class MerchantController {
  constructor(
    private readonly profiles: MerchantProfileService,
    private readonly branches: MerchantBranchService,
    private readonly verification: MerchantVerificationService,
    private readonly openingHours: OpeningHoursService,
    private readonly availability: BranchAvailabilityService,
    private readonly covers: MerchantBranchCoverService,
    private readonly logos: MerchantBranchLogoService,
    private readonly hoursExceptions: OpeningHoursExceptionService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Merchant bootstrap for the authenticated Account',
    description:
      'Never creates a Merchant. Returns merchantMembershipExists=false when the Account has no MerchantMember rows. An Account may belong to many Merchants. Each membership includes derived readiness and verification flags. Document metadata and evidence checklist are OWNER-only. MANAGER sees verification status/readiness/attention only. STAFF sees no verification package details. Catalog, Orders, Payments, and Settlements are not loaded.',
  })
  @ApiOkResponse({ type: MerchantMeResponseDto })
  getMe(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.profiles.getMe(principal.accountId);
  }

  @Get('legal/current')
  @ApiOperation({
    summary: 'Current active legal document versions',
    description:
      'Authenticated. Returns the active MERCHANT_TERMS and DOSSIER_ACCURACY_DECLARATION versions required by POST :merchantId/verification/submit. Seeds the default version 2026-10-03 for any kind with no active row. Registered before :merchantId routes.',
  })
  @ApiOkResponse({ type: MerchantCurrentLegalResponseDto })
  getCurrentLegal() {
    return this.verification.getCurrentLegalVersions();
  }

  @Post('profile')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a Merchant and founding OWNER membership',
    description:
      'Any authenticated ACTIVE Account may create a Merchant. Atomic: Merchant (status PENDING_REVIEW, verifiedAt null) + OWNER membership. publicReference, status, and verifiedAt are server-managed. OTP authentication never creates a Merchant. Body is name only.',
  })
  @ApiCreatedResponse({ type: MerchantMembershipResponseDto })
  createMerchant(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: CreateMerchantProfileDto,
  ) {
    return this.profiles.create(principal.accountId, { name: body.name });
  }

  @Patch(':merchantId/profile')
  @ApiOperation({
    summary: 'Partial update of a Merchant the Account is a member of',
    description:
      'OWNER only, and only when status is PENDING_REVIEW (before formal verification submission) or REJECTED. ACTIVE locks Merchant-side name edits. Formal SUBMITTED package under PENDING_REVIEW also locks name. SUSPENDED and unknown statuses reject mutation (MERCHANT_STATUS_RESTRICTED). MANAGER and STAFF receive MERCHANT_ROLE_FORBIDDEN. Only name is writable. status, verifiedAt, publicReference, commission, and ids are rejected. Foreign merchantId returns MERCHANT_NOT_FOUND.',
  })
  @ApiOkResponse({ type: MerchantMembershipResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
  })
  @ApiResponse({
    status: 409,
    description: MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
  })
  updateMerchant(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Body() body: UpdateMerchantProfileDto,
  ) {
    return this.profiles.update(principal.accountId, merchantId, {
      name: body.name,
    });
  }

  @Get(':merchantId/verification')
  @ApiOperation({
    summary: 'Merchant verification package for an accessible Merchant',
    description:
      'OWNER: full checklist and document metadata (no fileUrl). MANAGER: verification status and readiness/attention only (no document metadata). STAFF forbidden. status/verifiedAt are read-only. No binary download. Includes submittedAt, reviewedAt, attemptNumber, legalAcceptance (OWNER), currentIssues (OWNER) and unresolvedIssueCount; null/empty for legacy Merchants.',
  })
  @ApiOkResponse({ type: MerchantVerificationPackageResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
  })
  getVerification(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
  ) {
    return this.verification.getVerification(principal.accountId, merchantId);
  }

  @Post(':merchantId/verification/documents/:type/content')
  @HttpCode(200)
  @ApiParam({ name: 'type', enum: MERCHANT_DOCUMENT_TYPES })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PDF, JPEG, or PNG. Max 10 MiB.',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload private Merchant verification document bytes',
    description:
      'OWNER only. Multipart field `file`. Returns opaque uploadReference for PUT bind. No public URLs or storage paths.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: STORAGE_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  uploadVerificationDocumentContent(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('type') type: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw storageMalformedMultipart('Expected multipart field "file"');
    }
    return this.verification.uploadDocumentContent(
      principal.accountId,
      merchantId,
      type,
      {
        body: file.buffer,
        declaredMime: file.mimetype,
        originalFilename: file.originalname,
      },
    );
  }

  @Put(':merchantId/verification/documents/:type')
  @ApiOperation({
    summary: 'Register or replace Merchant verification document metadata',
    description:
      'OWNER only. Optional uploadReference binds private bytes from POST .../content. Metadata-only SpeedyGo application evidence categories: BUSINESS_IDENTITY, BUSINESS_REGISTRATION, SUPPORTING_DOCUMENT. Server assigns opaque storage key; client cannot set fileUrl or status. Editable while PENDING_REVIEW before formal submission, or REJECTED. Locked while submitted under review, ACTIVE, or SUSPENDED. expiryDate optional for all types; when present must be valid.',
  })
  @ApiParam({ name: 'type', enum: MERCHANT_DOCUMENT_TYPES })
  @ApiOkResponse({ type: MerchantMembershipResponseDto })
  @ApiResponse({
    status: 400,
    description: MERCHANT_ERROR_CODES.MERCHANT_DOCUMENT_INVALID,
  })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
  })
  @ApiResponse({
    status: 409,
    description: MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_INVALID_STATE,
  })
  upsertVerificationDocument(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('type') type: string,
    @Body() body: UpsertMerchantDocumentDto,
  ) {
    return this.verification.upsertDocument(principal.accountId, merchantId, {
      type,
      expiryDate: body.expiryDate,
      uploadReference: body.uploadReference,
    });
  }

  @Post(':merchantId/verification/submit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Submit Merchant verification package for trusted review',
    description:
      'OWNER only. Requires verificationReady and body.acceptances for both active legal kinds at their current versions. Creates a verification submission (attempt n+1) with append-only legal acceptances, marks required evidence SUBMITTED. Does not set ACTIVE. From REJECTED transitions Merchant to PENDING_REVIEW then submits. Repeat submit while already submitted is MERCHANT_VERIFICATION_INVALID_STATE.',
  })
  @ApiOkResponse({ type: MerchantMembershipResponseDto })
  @ApiResponse({
    status: 400,
    description:
      MERCHANT_ERROR_CODES.LEGAL_ACCEPTANCE_REQUIRED +
      ' / ' +
      MERCHANT_ERROR_CODES.LEGAL_VERSION_OUTDATED,
  })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
  })
  @ApiResponse({
    status: 409,
    description:
      MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_NOT_READY +
      ' / ' +
      MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_INVALID_STATE,
  })
  submitVerification(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Body() body: SubmitMerchantVerificationDto,
  ) {
    return this.verification.submitVerification(
      principal.accountId,
      merchantId,
      body.acceptances ?? [],
    );
  }

  @Get(':merchantId/branches')
  @ApiOperation({
    summary: 'List branches of an accessible Merchant',
    description:
      'Requires MerchantMember membership. OWNER, MANAGER, and STAFF may read. Admin RBAC does not grant access.',
  })
  @ApiOkResponse({ type: MerchantBranchListResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
  })
  listBranches(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
  ) {
    return this.branches.list(principal.accountId, merchantId);
  }

  @Post(':merchantId/branches')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a branch for an accessible Merchant',
    description:
      'OWNER and MANAGER. Blocked when Merchant status is SUSPENDED or unknown (MERCHANT_STATUS_RESTRICTED). No default/primary branch flag exists in schema. operationalStatus is server-managed ACTIVE. Coordinates are global ranges, not Algeria-bounded.',
  })
  @ApiCreatedResponse({ type: MerchantBranchResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
  })
  @ApiResponse({
    status: 409,
    description: MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
  })
  createBranch(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Body() body: CreateMerchantBranchDto,
  ) {
    return this.branches.create(principal.accountId, merchantId, {
      name: body.name,
      phone: body.phone,
      addressText: body.addressText,
      latitude: body.latitude,
      longitude: body.longitude,
      wilayaCode: body.wilayaCode,
      communeId: body.communeId,
    });
  }

  @Patch(':merchantId/branches/:branchId')
  @ApiOperation({
    summary: 'Partial update of an owned branch',
    description:
      'OWNER and MANAGER. operationalStatus is not writable. Cross-merchant branch ids return MERCHANT_BRANCH_NOT_FOUND. SUSPENDED Merchants cannot mutate branches.',
  })
  @ApiOkResponse({ type: MerchantBranchResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND,
  })
  @ApiResponse({
    status: 409,
    description: MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
  })
  updateBranch(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() body: UpdateMerchantBranchDto,
  ) {
    return this.branches.update(principal.accountId, merchantId, branchId, {
      name: body.name,
      phone: body.phone,
      addressText: body.addressText,
      latitude: body.latitude,
      longitude: body.longitude,
      wilayaCode: body.wilayaCode,
      communeId: body.communeId,
      description: body.description,
      nameAr: body.nameAr,
      publicEmail: body.publicEmail,
    });
  }

  @Delete(':merchantId/branches/:branchId')
  @ApiOperation({
    summary: 'Delete an owned branch',
    description:
      'OWNER and MANAGER. Last-branch delete is allowed for PENDING_REVIEW and REJECTED. An ACTIVE Merchant must keep at least one Branch (MERCHANT_LAST_BRANCH_REQUIRED). SUSPENDED Merchants cannot mutate branches. Schema has no deletedAt. PostgreSQL RESTRICT blocks delete when catalog/orders/carts reference the branch.',
  })
  @ApiOkResponse({ type: MerchantDeletedResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND,
  })
  @ApiResponse({
    status: 409,
    description: MERCHANT_ERROR_CODES.MERCHANT_LAST_BRANCH_REQUIRED,
  })
  deleteBranch(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ) {
    return this.branches.remove(principal.accountId, merchantId, branchId);
  }

  @Get(':merchantId/branches/:branchId/opening-hours')
  @ApiOperation({
    summary: 'Get Branch weekly opening hours',
    description:
      'MERCHANT_READ. Missing schedule returns hoursConfigured=false with empty days. Timezone is Africa/Algiers. operationalStatus is separate from hours.',
  })
  @ApiOkResponse({ type: OpeningHoursResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND,
  })
  getOpeningHours(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ) {
    return this.openingHours.getForMerchant(
      principal.accountId,
      merchantId,
      branchId,
    );
  }

  @Put(':merchantId/branches/:branchId/opening-hours')
  @ApiOperation({
    summary: 'Replace Branch weekly opening hours',
    description:
      'MERCHANT_BRANCH_UPDATE. Body requires expectedVersion (0 creates) and exactly 7 unique ISO days. Empty intervals = closed day. All empty = configured always closed. Optimistic concurrency → OPENING_HOURS_VERSION_CONFLICT.',
  })
  @ApiOkResponse({ type: OpeningHoursResponseDto })
  @ApiResponse({
    status: 400,
    description: OPENING_HOURS_ERROR_CODES.OPENING_HOURS_INVALID,
  })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND,
  })
  @ApiResponse({
    status: 409,
    description: OPENING_HOURS_ERROR_CODES.OPENING_HOURS_VERSION_CONFLICT,
  })
  putOpeningHours(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() body: PutOpeningHoursDto,
  ) {
    return this.openingHours.putForMerchant(
      principal.accountId,
      merchantId,
      branchId,
      {
        expectedVersion: body.expectedVersion,
        days: body.days,
      },
    );
  }

  @Get(':merchantId/branches/:branchId/opening-hours/exceptions')
  @ApiOperation({
    summary: 'List upcoming Branch opening-hours exceptions',
    description:
      'MERCHANT_READ (all Merchant roles). Exceptions dated today or later (Africa/Algiers) in date order. Each replaces the weekly schedule for its civil date only.',
  })
  @ApiOkResponse({ type: OpeningHoursExceptionListResponseDto })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND,
  })
  listOpeningHoursExceptions(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ) {
    return this.hoursExceptions.list(principal.accountId, merchantId, branchId);
  }

  @Put(':merchantId/branches/:branchId/opening-hours/exceptions/:date')
  @ApiOperation({
    summary: 'Create or replace the opening-hours exception for one date',
    description:
      'MERCHANT_BRANCH_UPDATE (OWNER, MANAGER). date is YYYY-MM-DD in Africa/Algiers, today..today+365. closed=true closes the whole date; otherwise 1–3 same-day intervals replace the weekly schedule for that date. expectedVersion=0 creates. Stale version → 409 OPENING_HOURS_EXCEPTION_VERSION_CONFLICT with error.openingHoursException (current row or null). Requires weekly hours.',
  })
  @ApiParam({ name: 'date', example: '2026-10-05' })
  @ApiOkResponse({ type: OpeningHoursExceptionResponseDto })
  @ApiResponse({
    status: 400,
    description:
      OPENING_HOURS_EXCEPTION_ERROR_CODES.OPENING_HOURS_EXCEPTION_INVALID,
  })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 409,
    description: `${OPENING_HOURS_EXCEPTION_ERROR_CODES.OPENING_HOURS_EXCEPTION_VERSION_CONFLICT} | ${OPENING_HOURS_EXCEPTION_ERROR_CODES.OPENING_HOURS_EXCEPTION_WEEKLY_REQUIRED}`,
  })
  putOpeningHoursException(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('date') date: string,
    @Body() body: PutOpeningHoursExceptionDto,
  ) {
    return this.hoursExceptions.put(
      principal.accountId,
      merchantId,
      branchId,
      date,
      {
        expectedVersion: body.expectedVersion,
        closed: body.closed,
        intervals: body.intervals,
        label: body.label,
        customerMessage: body.customerMessage,
      },
    );
  }

  @Delete(':merchantId/branches/:branchId/opening-hours/exceptions/:date')
  @ApiOperation({
    summary: 'Delete the opening-hours exception for one date',
    description:
      'MERCHANT_BRANCH_UPDATE. Query expectedVersion must match. The date falls back to the weekly schedule. Missing → 404 OPENING_HOURS_EXCEPTION_NOT_FOUND; stale → 409.',
  })
  @ApiParam({ name: 'date', example: '2026-10-05' })
  @ApiOkResponse({ type: OpeningHoursExceptionDeletedResponseDto })
  @ApiResponse({
    status: 404,
    description:
      OPENING_HOURS_EXCEPTION_ERROR_CODES.OPENING_HOURS_EXCEPTION_NOT_FOUND,
  })
  @ApiResponse({
    status: 409,
    description:
      OPENING_HOURS_EXCEPTION_ERROR_CODES.OPENING_HOURS_EXCEPTION_VERSION_CONFLICT,
  })
  deleteOpeningHoursException(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('date') date: string,
    @Query('expectedVersion') expectedVersion: string,
  ) {
    const parsed = /^\d+$/.test(expectedVersion ?? '')
      ? Number(expectedVersion)
      : Number.NaN;
    return this.hoursExceptions.remove(
      principal.accountId,
      merchantId,
      branchId,
      date,
      parsed,
    );
  }

  @Get(':merchantId/branches/:branchId/availability')
  @ApiOperation({
    summary: 'Get Branch availability override + effective open state',
    description:
      'MERCHANT_READ. FOLLOW_SCHEDULE means weekly hours decide (not Ouvert). isOpenNow/acceptingOrders are effective. Expired temporary overrides are evaluated without DB writes. operationalStatus is separate.',
  })
  @ApiOkResponse({ type: BranchAvailabilityResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND,
  })
  async getAvailability(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ): Promise<BranchAvailabilityResponseDto> {
    const view = await this.availability.getForMerchant(
      principal.accountId,
      merchantId,
      branchId,
    );
    return this.toAvailabilityResponse(view);
  }

  @Put(':merchantId/branches/:branchId/availability')
  @ApiOperation({
    summary: 'Set Branch availability override',
    description:
      'MERCHANT_BRANCH_UPDATE. expectedVersion=0 creates. TEMPORARY_CLOSED requires future closedUntil. FORCE_CLOSED has null closedUntil. Version conflict → AVAILABILITY_VERSION_CONFLICT (reload).',
  })
  @ApiOkResponse({ type: BranchAvailabilityResponseDto })
  @ApiResponse({
    status: 400,
    description: AVAILABILITY_ERROR_CODES.AVAILABILITY_INVALID,
  })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND,
  })
  @ApiResponse({
    status: 409,
    description: AVAILABILITY_ERROR_CODES.AVAILABILITY_VERSION_CONFLICT,
  })
  async putAvailability(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() body: PutBranchAvailabilityDto,
  ): Promise<BranchAvailabilityResponseDto> {
    const view = await this.availability.putForMerchant(
      principal.accountId,
      merchantId,
      branchId,
      {
        expectedVersion: body.expectedVersion,
        mode: body.mode,
        reasonCode: body.reasonCode,
        customerMessage: body.customerMessage,
        closedUntil: body.closedUntil,
      },
    );
    return this.toAvailabilityResponse(view);
  }

  private toAvailabilityResponse(
    view: Awaited<ReturnType<BranchAvailabilityService['getForMerchant']>>,
  ): BranchAvailabilityResponseDto {
    return {
      branchId: view.branchId,
      timezone: view.timezone,
      availabilityMode: view.availabilityMode,
      effectiveMode: view.effectiveMode,
      hoursConfigured: view.hoursConfigured,
      isOpenNow: view.isOpenNow,
      acceptingOrders: view.acceptingOrders,
      temporaryExpired: view.temporaryExpired,
      outsideWeeklyHours: view.outsideWeeklyHours,
      hoursException: view.hoursException,
      reasonCode: view.reasonCode,
      customerMessage: view.customerMessage,
      closedUntil: view.closedUntil,
      nextOpenAt: view.nextOpenAt ? view.nextOpenAt.toISOString() : null,
      currentClosesAt: view.currentClosesAt
        ? view.currentClosesAt.toISOString()
        : null,
      version: view.version,
      updatedAt: view.updatedAt,
    };
  }

  @Post(':merchantId/branches/:branchId/cover/content')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'JPEG or PNG. 400–4096 px. Max 2 MiB.',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload pending storefront cover bytes',
    description:
      'OWNER and MANAGER (MERCHANT_BRANCH_UPDATE). Multipart field `file`. Purpose MERCHANT_BRANCH_COVER only. Returns opaque uploadReference for PUT bind. Never a verification document or public URL.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: COVER_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  uploadBranchCoverContent(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw storageMalformedMultipart('Expected multipart field "file"');
    }
    return this.covers.uploadContent(
      principal.accountId,
      merchantId,
      branchId,
      {
        body: file.buffer,
        declaredMime: file.mimetype,
        originalFilename: file.originalname,
      },
    );
  }

  @Get(':merchantId/branches/:branchId/cover')
  @ApiOperation({
    summary: 'Stream the bound storefront cover',
    description:
      'MERCHANT_READ (and stronger roles). Streams the bound covers/ object for an owned Branch. Missing cover → STORAGE_OBJECT_MISSING. Never a verification document or product image.',
  })
  async getBranchCover(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.covers.readForMerchant(
      principal.accountId,
      merchantId,
      branchId,
    );
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(file.body);
  }

  @Put(':merchantId/branches/:branchId/cover')
  @ApiOperation({
    summary: 'Bind or replace the storefront cover',
    description:
      'OWNER and MANAGER. uploadReference must be a MERCHANT_BRANCH_COVER pending token owned by this Account and Merchant. Replaces the previous covers/ object.',
  })
  bindBranchCover(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() body: BindMerchantBranchCoverDto,
  ) {
    return this.covers.bind(
      principal.accountId,
      merchantId,
      branchId,
      body.uploadReference,
    );
  }

  @Delete(':merchantId/branches/:branchId/cover')
  @ApiOperation({
    summary: 'Delete the storefront cover',
    description: 'OWNER and MANAGER. Removes metadata and the covers/ object.',
  })
  deleteBranchCover(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ) {
    return this.covers.remove(principal.accountId, merchantId, branchId);
  }

  @Post(':merchantId/branches/:branchId/logo/content')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'JPEG or PNG. 128–2048 px. Max 1 MiB.',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload pending store logo bytes',
    description:
      'OWNER and MANAGER (MERCHANT_BRANCH_UPDATE). Multipart field `file`. Purpose MERCHANT_BRANCH_LOGO only. Returns opaque uploadReference for PUT bind. A cover token cannot be bound as a logo.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: LOGO_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  uploadBranchLogoContent(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw storageMalformedMultipart('Expected multipart field "file"');
    }
    return this.logos.uploadContent(principal.accountId, merchantId, branchId, {
      body: file.buffer,
      declaredMime: file.mimetype,
      originalFilename: file.originalname,
    });
  }

  @Get(':merchantId/branches/:branchId/logo')
  @ApiOperation({
    summary: 'Stream the bound store logo',
    description:
      'MERCHANT_READ (all Merchant roles). Streams the bound logos/ object for an owned Branch. ETag changes on every replacement; Cache-Control private, no-cache. Missing logo → STORAGE_OBJECT_MISSING (404).',
  })
  async getBranchLogo(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.logos.readForMerchant(
      principal.accountId,
      merchantId,
      branchId,
    );
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', `"${file.version}"`);
    return new StreamableFile(file.body);
  }

  @Put(':merchantId/branches/:branchId/logo')
  @ApiOperation({
    summary: 'Bind or replace the store logo',
    description:
      'OWNER and MANAGER. uploadReference must be a MERCHANT_BRANCH_LOGO pending token owned by this Account, Merchant and Branch. Each bind creates a new logos/ object; the replaced object is deleted only when unreferenced.',
  })
  bindBranchLogo(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() body: BindMerchantBranchLogoDto,
  ) {
    return this.logos.bind(
      principal.accountId,
      merchantId,
      branchId,
      body.uploadReference,
    );
  }

  @Delete(':merchantId/branches/:branchId/logo')
  @ApiOperation({
    summary: 'Delete the store logo',
    description:
      'OWNER and MANAGER. Removes logo metadata and the logos/ object. Idempotent: deleting a missing logo returns deleted=true.',
  })
  deleteBranchLogo(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ) {
    return this.logos.remove(principal.accountId, merchantId, branchId);
  }
}
