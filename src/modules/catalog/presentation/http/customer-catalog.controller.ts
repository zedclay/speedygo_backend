import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
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
import {
  CustomerCatalogPaginationQueryDto,
  CustomerCatalogProductListQueryDto,
  CustomerCatalogSearchQueryDto,
  CustomerCatalogSearchResponseDto,
  CustomerCategoryListResponseDto,
  CustomerProductDetailResponseDto,
  CustomerProductListResponseDto,
  CustomerStorefrontListResponseDto,
  CustomerStorefrontDetailResponseDto,
} from './dto/customer-catalog.dto';

@ApiTags('customer-catalog')
@ApiBearerAuth()
@Controller('customer')
export class CustomerCatalogController {
  constructor(private readonly discovery: CustomerCatalogService) {}

  @Get('branches')
  @ApiOperation({
    summary: 'List Customer-visible storefronts (MerchantBranch)',
    description:
      'Authenticated CustomerProfile required. Returns Branches where Merchant is ACTIVE+verified with non-empty name and Branch operationalStatus=ACTIVE. Includes opening-hours projection (hoursConfigured/isOpenNow/timezone/currentClosesAt/nextOpenAt). Does not claim delivery eligibility.',
  })
  @ApiOkResponse({ type: CustomerStorefrontListResponseDto })
  @ApiResponse({
    status: 404,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
  })
  listBranches(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: CustomerCatalogPaginationQueryDto,
  ) {
    return this.discovery.listStorefronts(principal.accountId, query);
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
