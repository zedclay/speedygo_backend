import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { MERCHANT_ERROR_CODES } from '../../../merchants/domain/merchant.errors';
import { MerchantBranchClassificationService } from '../../application/merchant-branch-classification.service';
import { COMMERCE_VERTICAL_ERROR_CODES } from '../../domain/commerce-vertical.errors';
import {
  AssignBranchClassificationDto,
  MerchantBranchClassificationResponseDto,
  MerchantCommerceVerticalListResponseDto,
} from './dto/merchant-branch-classification.dto';

/**
 * `commerce-verticals` is a single-segment static route. It is declared
 * before every `:merchantId/...` route and this controller is registered
 * ahead of the other `merchant` controllers.
 */
@ApiTags('merchant-store-category')
@ApiBearerAuth()
@Controller('merchant')
export class MerchantBranchClassificationController {
  constructor(
    private readonly classification: MerchantBranchClassificationService,
  ) {}

  @Get('commerce-verticals')
  @ApiOperation({
    summary: 'List active store categories (CommerceVerticals)',
    description:
      'Active only, sorted by sortOrder. Any authenticated Merchant member (OWNER, MANAGER, STAFF).',
  })
  @ApiOkResponse({ type: MerchantCommerceVerticalListResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  listVerticals(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.classification.listActiveVerticals(principal.accountId);
  }

  @Get(':merchantId/branches/:branchId/classification')
  @ApiOperation({
    summary: 'Get Branch store category',
    description: 'Membership required. OWNER, MANAGER, and STAFF may read.',
  })
  @ApiOkResponse({ type: MerchantBranchClassificationResponseDto })
  getClassification(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ) {
    return this.classification.get(principal.accountId, merchantId, branchId);
  }

  @Put(':merchantId/branches/:branchId/classification')
  @ApiOperation({
    summary: 'Set Branch store category',
    description:
      'OWNER and MANAGER (MERCHANT_BRANCH_UPDATE). Exactly one active CommerceVertical per Branch; replaces any existing value.',
  })
  @ApiOkResponse({ type: MerchantBranchClassificationResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: `${MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND} / ${COMMERCE_VERTICAL_ERROR_CODES.COMMERCE_VERTICAL_NOT_FOUND} / ${COMMERCE_VERTICAL_ERROR_CODES.COMMERCE_VERTICAL_INACTIVE}`,
  })
  assignClassification(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() body: AssignBranchClassificationDto,
  ) {
    return this.classification.assign(
      principal.accountId,
      merchantId,
      branchId,
      body.verticalId,
    );
  }

  @Delete(':merchantId/branches/:branchId/classification')
  @ApiOperation({
    summary: 'Clear Branch store category',
    description:
      'OWNER and MANAGER (MERCHANT_BRANCH_UPDATE). Idempotent. Unclassified Branches remain valid.',
  })
  @ApiOkResponse({ type: MerchantBranchClassificationResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  clearClassification(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ) {
    return this.classification.clear(principal.accountId, merchantId, branchId);
  }
}
