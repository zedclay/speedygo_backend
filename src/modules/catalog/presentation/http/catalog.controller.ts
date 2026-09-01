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
  Query,
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
import { MERCHANT_ERROR_CODES } from '../../../merchants/domain/merchant.errors';
import { CatalogService } from '../../application/catalog.service';
import { CATALOG_ERROR_CODES } from '../../domain/catalog.errors';
import {
  CatalogBootstrapResponseDto,
  CatalogCategoryListResponseDto,
  CatalogCategoryResponseDto,
  CatalogDeletedResponseDto,
  CatalogOptionGroupListResponseDto,
  CatalogOptionGroupResponseDto,
  CatalogOptionResponseDto,
  CatalogProductDetailResponseDto,
  CatalogProductListResponseDto,
} from './dto/catalog-response.dto';
import {
  CatalogBranchQueryDto,
  CreateCatalogCategoryDto,
  CreateCatalogOptionDto,
  CreateCatalogOptionGroupDto,
  CreateCatalogProductDto,
  ListCatalogProductsQueryDto,
  UpdateCatalogCategoryDto,
  UpdateCatalogOptionDto,
  UpdateCatalogOptionGroupDto,
  UpdateCatalogProductDto,
} from './dto/catalog-write.dto';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('merchant/:merchantId')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('catalog')
  @ApiOperation({
    summary: 'Branch catalog bootstrap',
    description:
      'Returns categories and catalog stats for one owned Branch. Does not load Products, Orders, Payments, or Settlements. Catalog does not make the Merchant operationalReady. Catalog resources are Branch-owned.',
  })
  @ApiOkResponse({ type: CatalogBootstrapResponseDto })
  @ApiResponse({
    status: 404,
    description: `${MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND} or ${MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND}`,
  })
  getCatalog(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Query() query: CatalogBranchQueryDto,
  ) {
    return this.catalog.bootstrap(
      principal.accountId,
      merchantId,
      query.branchId,
    );
  }

  @Get('categories')
  @ApiOperation({
    summary: 'List Branch categories',
    description:
      'Categories are MerchantBranch-owned. branchId is required. OWNER, MANAGER, and STAFF may read.',
  })
  @ApiOkResponse({ type: CatalogCategoryListResponseDto })
  listCategories(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Query() query: CatalogBranchQueryDto,
  ) {
    return this.catalog.listCategories(
      principal.accountId,
      merchantId,
      query.branchId,
    );
  }

  @Post('categories')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a Branch category',
    description:
      'OWNER and MANAGER. Catalog is Branch-owned. A Merchant may exist without a Branch, but Category/Product creation requires a valid owned Branch. There is no Merchant-level Product master.',
  })
  @ApiCreatedResponse({ type: CatalogCategoryResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 409,
    description: MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
  })
  createCategory(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Body() body: CreateCatalogCategoryDto,
  ) {
    return this.catalog.createCategory(
      principal.accountId,
      merchantId,
      body.branchId,
      {
        name: body.name,
        sortOrder: body.sortOrder,
        active: body.active,
      },
    );
  }

  @Patch('categories/:categoryId')
  @ApiOperation({
    summary: 'Update an owned category',
    description:
      'OWNER and MANAGER. Foreign or cross-Merchant category ids return CATALOG_CATEGORY_NOT_FOUND. Category.active is customer-facing visibility, not hard deletion.',
  })
  @ApiOkResponse({ type: CatalogCategoryResponseDto })
  @ApiResponse({
    status: 404,
    description: CATALOG_ERROR_CODES.CATALOG_CATEGORY_NOT_FOUND,
  })
  updateCategory(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
    @Body() body: UpdateCatalogCategoryDto,
  ) {
    return this.catalog.updateCategory(
      principal.accountId,
      merchantId,
      categoryId,
      {
        name: body.name,
        sortOrder: body.sortOrder,
        active: body.active,
      },
    );
  }

  @Delete('categories/:categoryId')
  @ApiOperation({
    summary: 'Delete an empty owned category',
    description:
      'Hard delete only when empty. Products still attached return CATALOG_CATEGORY_IN_USE. Category.active=false hides the Category from future customer catalog without deleting it or its Products.',
  })
  @ApiOkResponse({ type: CatalogDeletedResponseDto })
  @ApiResponse({
    status: 409,
    description: CATALOG_ERROR_CODES.CATALOG_CATEGORY_IN_USE,
  })
  deleteCategory(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
  ) {
    return this.catalog.deleteCategory(
      principal.accountId,
      merchantId,
      categoryId,
    );
  }

  @Get('products')
  @ApiOperation({
    summary: 'List Branch products',
    description:
      'Paginated. Optional filters: categoryId, available (operational offer, not archive), q (name contains). Option trees are not included.',
  })
  @ApiOkResponse({ type: CatalogProductListResponseDto })
  listProducts(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Query() query: ListCatalogProductsQueryDto,
  ) {
    return this.catalog.listProducts(
      principal.accountId,
      merchantId,
      query.branchId,
      {
        categoryId: query.categoryId,
        available: query.available,
        q: query.q,
        limit: query.limit,
        offset: query.offset,
      },
    );
  }

  @Get('products/:productId')
  @ApiOperation({
    summary: 'Get a Product with option groups and options',
  })
  @ApiOkResponse({ type: CatalogProductDetailResponseDto })
  @ApiResponse({
    status: 404,
    description: CATALOG_ERROR_CODES.CATALOG_PRODUCT_NOT_FOUND,
  })
  getProduct(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ) {
    return this.catalog.getProduct(principal.accountId, merchantId, productId);
  }

  @Post('products')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a Product',
    description:
      'OWNER and MANAGER. categoryId must belong to the same Branch. priceMinor is integer minor units. available is operational offer, not archive. No image or DRAFT/PUBLISHED fields exist on Product.',
  })
  @ApiCreatedResponse({ type: CatalogProductDetailResponseDto })
  @ApiResponse({
    status: 400,
    description: CATALOG_ERROR_CODES.CATALOG_INVALID_PRICE,
  })
  createProduct(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Body() body: CreateCatalogProductDto,
  ) {
    return this.catalog.createProduct(
      principal.accountId,
      merchantId,
      body.branchId,
      {
        categoryId: body.categoryId,
        name: body.name,
        description: body.description,
        priceMinor: body.priceMinor,
        available: body.available,
      },
    );
  }

  @Patch('products/:productId')
  @ApiOperation({
    summary: 'Update an owned Product',
    description:
      'Cannot move a Product to another Branch. categoryId must stay on the same Branch. available=false keeps the Product stored and editable.',
  })
  @ApiOkResponse({ type: CatalogProductDetailResponseDto })
  updateProduct(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() body: UpdateCatalogProductDto,
  ) {
    return this.catalog.updateProduct(
      principal.accountId,
      merchantId,
      productId,
      {
        categoryId: body.categoryId,
        name: body.name,
        description: body.description,
        priceMinor: body.priceMinor,
        available: body.available,
      },
    );
  }

  @Delete('products/:productId')
  @ApiOperation({
    summary: 'Hard-delete an owned Product',
    description:
      'Hard-delete only when no OrderItem references the Product. Historical use returns CATALOG_PRODUCT_IN_USE; set available=false instead. available=false is not deletion. Option groups/options cascade when delete is allowed.',
  })
  @ApiOkResponse({ type: CatalogDeletedResponseDto })
  @ApiResponse({
    status: 409,
    description: CATALOG_ERROR_CODES.CATALOG_PRODUCT_IN_USE,
  })
  deleteProduct(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ) {
    return this.catalog.deleteProduct(
      principal.accountId,
      merchantId,
      productId,
    );
  }

  @Get('products/:productId/option-groups')
  @ApiOperation({ summary: 'List option groups for an owned Product' })
  @ApiOkResponse({ type: CatalogOptionGroupListResponseDto })
  listOptionGroups(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ) {
    return this.catalog.listOptionGroups(
      principal.accountId,
      merchantId,
      productId,
    );
  }

  @Post('products/:productId/option-groups')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create an option group',
    description:
      'required=true needs minSelections>=1. required=false needs minSelections=0. maxSelections>=1 and >= minSelections.',
  })
  @ApiCreatedResponse({ type: CatalogOptionGroupResponseDto })
  @ApiResponse({
    status: 400,
    description: CATALOG_ERROR_CODES.CATALOG_OPTION_GROUP_INVALID,
  })
  createOptionGroup(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() body: CreateCatalogOptionGroupDto,
  ) {
    return this.catalog.createOptionGroup(
      principal.accountId,
      merchantId,
      productId,
      {
        name: body.name,
        required: body.required,
        minSelections: body.minSelections,
        maxSelections: body.maxSelections,
      },
    );
  }

  @Patch('products/:productId/option-groups/:groupId')
  @ApiOperation({
    summary: 'Update an owned option group',
    description:
      'required=true needs minSelections>=1. required=false needs minSelections=0. maxSelections>=1 and >= minSelections.',
  })
  @ApiOkResponse({ type: CatalogOptionGroupResponseDto })
  updateOptionGroup(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Body() body: UpdateCatalogOptionGroupDto,
  ) {
    return this.catalog.updateOptionGroup(
      principal.accountId,
      merchantId,
      productId,
      groupId,
      {
        name: body.name,
        required: body.required,
        minSelections: body.minSelections,
        maxSelections: body.maxSelections,
      },
    );
  }

  @Delete('products/:productId/option-groups/:groupId')
  @ApiOperation({
    summary: 'Delete an option group',
    description:
      'Options cascade with the group. Order snapshots are unaffected.',
  })
  @ApiOkResponse({ type: CatalogDeletedResponseDto })
  deleteOptionGroup(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
  ) {
    return this.catalog.deleteOptionGroup(
      principal.accountId,
      merchantId,
      productId,
      groupId,
    );
  }

  @Post('products/:productId/option-groups/:groupId/options')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create an option',
    description:
      'additionalPriceMinor is a non-negative integer in minor units. Negative deltas are rejected. available is operational selectability, not archive.',
  })
  @ApiCreatedResponse({ type: CatalogOptionResponseDto })
  createOption(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Body() body: CreateCatalogOptionDto,
  ) {
    return this.catalog.createOption(
      principal.accountId,
      merchantId,
      productId,
      groupId,
      {
        name: body.name,
        additionalPriceMinor: body.additionalPriceMinor,
        available: body.available,
      },
    );
  }

  @Patch('products/:productId/option-groups/:groupId/options/:optionId')
  @ApiOperation({
    summary: 'Update an owned option',
    description:
      'available=false keeps the Option stored but not selectable. additionalPriceMinor remains integer minor units >= 0.',
  })
  @ApiOkResponse({ type: CatalogOptionResponseDto })
  updateOption(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Param('optionId', new ParseUUIDPipe()) optionId: string,
    @Body() body: UpdateCatalogOptionDto,
  ) {
    return this.catalog.updateOption(
      principal.accountId,
      merchantId,
      productId,
      groupId,
      optionId,
      {
        name: body.name,
        additionalPriceMinor: body.additionalPriceMinor,
        available: body.available,
      },
    );
  }

  @Delete('products/:productId/option-groups/:groupId/options/:optionId')
  @ApiOperation({
    summary: 'Delete an option',
    description:
      'Historical order option snapshots do not FK to live options. Live cart/catalog rows are removed.',
  })
  @ApiOkResponse({ type: CatalogDeletedResponseDto })
  deleteOption(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Param('optionId', new ParseUUIDPipe()) optionId: string,
  ) {
    return this.catalog.deleteOption(
      principal.accountId,
      merchantId,
      productId,
      groupId,
      optionId,
    );
  }
}
