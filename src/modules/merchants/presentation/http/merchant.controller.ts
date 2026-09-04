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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { MerchantBranchService } from '../../application/merchant-branch.service';
import { MerchantProfileService } from '../../application/merchant-profile.service';
import { MerchantVerificationService } from '../../application/merchant-verification.service';
import { MERCHANT_ERROR_CODES } from '../../domain/merchant.errors';
import { MERCHANT_DOCUMENT_TYPES } from '../../domain/merchant.policy';
import {
  MerchantBranchListResponseDto,
  MerchantBranchResponseDto,
  MerchantDeletedResponseDto,
  MerchantMeResponseDto,
  MerchantMembershipResponseDto,
  MerchantVerificationPackageResponseDto,
} from './dto/merchant-response.dto';
import {
  CreateMerchantBranchDto,
  CreateMerchantProfileDto,
  UpdateMerchantBranchDto,
  UpdateMerchantProfileDto,
  UpsertMerchantDocumentDto,
} from './dto/merchant-write.dto';

@ApiTags('merchant')
@ApiBearerAuth()
@Controller('merchant')
export class MerchantController {
  constructor(
    private readonly profiles: MerchantProfileService,
    private readonly branches: MerchantBranchService,
    private readonly verification: MerchantVerificationService,
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
      'OWNER: full checklist and document metadata (no fileUrl). MANAGER: verification status and readiness/attention only (no document metadata). STAFF forbidden. status/verifiedAt are read-only. No binary download. No rejection reason field exists in v1.0.',
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

  @Put(':merchantId/verification/documents/:type')
  @ApiOperation({
    summary: 'Register or replace Merchant verification document metadata',
    description:
      'OWNER only. Metadata-only SpeedyGo application evidence categories (not Algerian statutory names): BUSINESS_IDENTITY, BUSINESS_REGISTRATION, SUPPORTING_DOCUMENT. Server assigns opaque storage key; client cannot set fileUrl or status. Editable while PENDING_REVIEW before formal submission, or REJECTED. Locked while submitted under review, ACTIVE, or SUSPENDED. expiryDate optional for all types; when present must be valid.',
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
    });
  }

  @Post(':merchantId/verification/submit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Submit Merchant verification package for trusted review',
    description:
      'OWNER only. Requires verificationReady. Marks required evidence SUBMITTED. Does not set ACTIVE. From REJECTED transitions Merchant to PENDING_REVIEW then submits. Repeat submit while already submitted is MERCHANT_VERIFICATION_INVALID_STATE.',
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
    description:
      MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_NOT_READY +
      ' / ' +
      MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_INVALID_STATE,
  })
  submitVerification(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
  ) {
    return this.verification.submitVerification(
      principal.accountId,
      merchantId,
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
}
