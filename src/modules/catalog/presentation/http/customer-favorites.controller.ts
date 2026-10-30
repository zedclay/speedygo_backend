import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { CustomerFavoritesService } from '../../application/customer-favorites.service';
import { CustomerFavoritesListQueryDto } from './dto/customer-favorites.dto';

@ApiTags('customer-favorites')
@ApiBearerAuth()
@Controller('customer/favorites')
export class CustomerFavoritesController {
  constructor(private readonly favorites: CustomerFavoritesService) {}

  @Get()
  @ApiOperation({
    summary: 'List owned Customer favorites',
    description:
      'Authenticated CustomerProfile required. kind=BRANCH (default) or PRODUCT. Stale/hidden targets are omitted. Ownership is the signed-in profile only. Optional addressId annotates each visible target with live delivery coverage for that owned pin (INSIDE/OUTSIDE/UNFILTERED/AMBIGUOUS). Coverage is not stored on the favorite. Unowned addressId → CUSTOMER_ADDRESS_NOT_FOUND. Customer-safe: no zone ids or names.',
  })
  list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: CustomerFavoritesListQueryDto,
  ) {
    return this.favorites.list(
      principal.accountId,
      query.kind,
      query.addressId,
    );
  }

  @Get('ids')
  @ApiOperation({
    summary: 'List owned favorite target ids',
    description:
      'Lightweight branch and product id sets for heart state. Account-scoped.',
  })
  listIds(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.favorites.listIds(principal.accountId);
  }

  @Put('branches/:branchId')
  @ApiOperation({
    summary: 'Save a visible storefront as a favorite',
    description: 'Idempotent. 404 if the branch is not Customer-visible.',
  })
  addBranch(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.favorites.addBranch(principal.accountId, branchId);
  }

  @Delete('branches/:branchId')
  @ApiOperation({
    summary: 'Remove a storefront favorite',
    description: 'Idempotent even if the row is already absent.',
  })
  removeBranch(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.favorites.removeBranch(principal.accountId, branchId);
  }

  @Put('products/:productId')
  @ApiOperation({
    summary: 'Save a visible product as a favorite',
    description: 'Idempotent. 404 if the product is not Customer-offerable.',
  })
  addProduct(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.favorites.addProduct(principal.accountId, productId);
  }

  @Delete('products/:productId')
  @ApiOperation({
    summary: 'Remove a product favorite',
    description: 'Idempotent even if the row is already absent.',
  })
  removeProduct(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.favorites.removeProduct(principal.accountId, productId);
  }
}
