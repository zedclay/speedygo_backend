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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { MerchantBranchService } from '../../application/merchant-branch.service';
import { MerchantProfileService } from '../../application/merchant-profile.service';
import { MERCHANT_ERROR_CODES } from '../../domain/merchant.errors';
import {
  MerchantBranchListResponseDto,
  MerchantBranchResponseDto,
  MerchantDeletedResponseDto,
  MerchantMeResponseDto,
  MerchantMembershipResponseDto,
} from './dto/merchant-response.dto';
import {
  CreateMerchantBranchDto,
  CreateMerchantProfileDto,
  UpdateMerchantBranchDto,
  UpdateMerchantProfileDto,
} from './dto/merchant-write.dto';

@ApiTags('merchant')
@ApiBearerAuth()
@Controller('merchant')
export class MerchantController {
  constructor(
    private readonly profiles: MerchantProfileService,
    private readonly branches: MerchantBranchService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Merchant bootstrap for the authenticated Account',
    description:
      'Never creates a Merchant. Returns merchantMembershipExists=false when the Account has no MerchantMember rows. An Account may belong to many Merchants. Each membership includes derived readiness. Catalog, Orders, Payments, and Settlements are not loaded.',
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
      'OWNER only, and only when status is PENDING_REVIEW or REJECTED. ACTIVE locks Merchant-side name edits. SUSPENDED and unknown statuses reject mutation (MERCHANT_STATUS_RESTRICTED). MANAGER and STAFF receive MERCHANT_ROLE_FORBIDDEN. Only name is writable. status, verifiedAt, publicReference, commission, and ids are rejected. Foreign merchantId returns MERCHANT_NOT_FOUND.',
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
    summary: 'Hard-delete an owned branch',
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
    description: `${MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED} or ${MERCHANT_ERROR_CODES.MERCHANT_LAST_BRANCH_REQUIRED}`,
  })
  deleteBranch(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ) {
    return this.branches.remove(principal.accountId, merchantId, branchId);
  }
}
