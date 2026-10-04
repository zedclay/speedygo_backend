import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
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
import { CUSTOMER_ERROR_CODES } from '../../../customers/domain/customer.errors';
import { CustomerCatalogService } from '../../application/customer-catalog.service';
import { CUSTOMER_CATALOG_ERROR_CODES } from '../../domain/customer-catalog.errors';
import type { Response } from 'express';
import { COMMERCE_VERTICAL_ERROR_CODES } from '../../domain/commerce-vertical.errors';
import {
  CustomerCatalogProductListQueryDto,
  CustomerCatalogSearchQueryDto,
  CustomerCatalogSearchResponseDto,
  CustomerCategoryListResponseDto,
  CustomerCommerceVerticalListResponseDto,
  CustomerProductDetailResponseDto,
  CustomerProductListResponseDto,
  CustomerStorefrontListQueryDto,
  CustomerStorefrontListResponseDto,
  CustomerStorefrontDetailResponseDto,
} from './dto/customer-catalog.dto';

@ApiTags('customer-catalog')
@ApiBearerAuth()
@Controller('customer')
export class CustomerCatalogController {
  constructor(private readonly discovery: CustomerCatalogService) {}

  @Get('commerce-verticals')
  @ApiOperation({
    summary: 'List active platform commerce categories',
    description:
      'Authenticated CustomerProfile required. Inactive verticals are omitted. Separate from per-branch menu Category.',
  })
  @ApiOkResponse({ type: CustomerCommerceVerticalListResponseDto })
  @ApiResponse({
    status: 404,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
  })
  listCommerceVerticals(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.discovery.listCommerceVerticals(principal.accountId);
  }

  @Get('branches')
  @ApiOperation({
    summary: 'List Customer-visible storefronts (MerchantBranch)',
    description:
      'Authenticated CustomerProfile required. Returns Branches where Merchant is ACTIVE+verified with non-empty name and Branch operationalStatus=ACTIVE. Optional verticalId filters to explicitly classified branches of an active commerce vertical. Optional openNow=true keeps only branches open at request time (authoritative hours evaluator; unconfigured excluded). Unfiltered lists include unclassified branches and branches classified to a deactivated vertical. Includes opening-hours projection. Does not claim delivery eligibility or order acceptance.',
  })
  @ApiOkResponse({ type: CustomerStorefrontListResponseDto })
  @ApiResponse({
    status: 404,
    description: `${CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND} or ${COMMERCE_VERTICAL_ERROR_CODES.COMMERCE_VERTICAL_NOT_FOUND}`,
  })
  listBranches(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: CustomerStorefrontListQueryDto,
  ) {
    return this.discovery.listStorefronts(principal.accountId, query);
  }

  @Get('branches/:branchId/cover')
  @ApiOperation({
    summary: 'Stream the storefront cover image',
    description:
      'Authenticated CustomerProfile and a visible storefront required. Hidden branches return CUSTOMER_STOREFRONT_NOT_FOUND. Missing cover returns STORAGE_OBJECT_MISSING. Never a verification document.',
  })
  @ApiResponse({
    status: 404,
    description: `${CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND} or ${CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_STOREFRONT_NOT_FOUND}`,
  })
  async getCover(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.discovery.readCover(principal.accountId, branchId);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(file.body);
  }

  @Get('branches/:branchId')
  @ApiOperation({
    summary: 'Get a Customer-visible storefront',
    description:
      'Fail-closed: hidden or ineligible Branches return CUSTOMER_STOREFRONT_NOT_FOUND. Omits phone, verification, commission, and settlement fields.',
  })
  @ApiOkResponse({ type: CustomerStorefrontDetailResponseDto })
  @ApiResponse({
    status: 404,
    description: `${CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND} or ${CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_STOREFRONT_NOT_FOUND}`,
  })
  getBranch(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.discovery.getStorefront(principal.accountId, branchId);
  }

  @Get('branches/:branchId/categories')
  @ApiOperation({
    summary: 'List active categories with orderable products for a storefront',
  })
  @ApiOkResponse({ type: CustomerCategoryListResponseDto })
  @ApiResponse({
    status: 404,
    description: `${CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND} or ${CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_STOREFRONT_NOT_FOUND}`,
  })
  listCategories(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.discovery.listCategories(principal.accountId, branchId);
  }

  @Get('branches/:branchId/products')
  @ApiOperation({
    summary: 'List orderable products for a storefront',
    description:
      'Only products satisfying isProductCustomerOfferable. productId is the Cart add-item identifier. priceMinor is informational decimal string.',
  })
  @ApiOkResponse({ type: CustomerProductListResponseDto })
  @ApiResponse({
    status: 404,
    description: `${CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND} or ${CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_STOREFRONT_NOT_FOUND}`,
  })
  listProducts(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: CustomerCatalogProductListQueryDto,
  ) {
    return this.discovery.listProducts(principal.accountId, branchId, query);
  }

  @Get('branches/:branchId/products/:productId')
  @ApiOperation({
    summary: 'Get an orderable product detail including option groups',
  })
  @ApiOkResponse({ type: CustomerProductDetailResponseDto })
  @ApiResponse({
    status: 404,
    description: `${CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND} or ${CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_PRODUCT_NOT_FOUND}`,
  })
  getProduct(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.discovery.getProduct(principal.accountId, branchId, productId);
  }

  @Get('branches/:branchId/products/:productId/image')
  @ApiOperation({
    summary: 'Stream the product photograph',
    description:
      'Authenticated CustomerProfile and a visible orderable product required. Hidden products return CUSTOMER_PRODUCT_NOT_FOUND. Missing image returns STORAGE_OBJECT_MISSING. Never a verification document or storefront cover.',
  })
  @ApiResponse({
    status: 404,
    description: `${CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND} or ${CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_PRODUCT_NOT_FOUND}`,
  })
  async getProductImage(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.discovery.readProductImage(
      principal.accountId,
      branchId,
      productId,
    );
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(file.body);
  }

  @Get('catalog/search')
  @ApiOperation({
    summary: 'Bounded Customer catalog search',
    description:
      'Searches visible storefront names (branch or merchant) and offerable product names. Trimmed q length 2..100. LIKE wildcards stripped. Deterministic order: hit_type ASC, name ASC, id ASC. No ranking claims.',
  })
  @ApiOkResponse({ type: CustomerCatalogSearchResponseDto })
  @ApiResponse({
    status: 400,
    description: CUSTOMER_CATALOG_ERROR_CODES.CUSTOMER_SEARCH_QUERY_INVALID,
  })
  @ApiResponse({
    status: 404,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
  })
  search(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: CustomerCatalogSearchQueryDto,
  ) {
    return this.discovery.search(principal.accountId, query);
  }
}
