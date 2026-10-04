import { Controller, Get, Query } from '@nestjs/common';
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
import { PromotionService } from '../../application/promotion.service';
import { CUSTOMER_PROMOTION_DISCOVERY_DEFAULT_LIMIT } from '../../domain/promotion.types';
import {
  CustomerDiscoverablePromotionListDto,
  CustomerPromotionListQueryDto,
} from './dto/customer-promotion.dto';

@ApiTags('customer-promotions')
@ApiBearerAuth()
@Controller('customer')
export class CustomerPromotionController {
  constructor(private readonly promotions: PromotionService) {}

  @Get('promotions')
  @ApiOperation({
    summary: 'List Customer-discoverable promotions',
    description:
      'Authenticated CustomerProfile required. Returns only offers explicitly published for Customer discovery that are currently effective. Existing promotions stay hidden unless published. Discovery is not cart eligibility — Checkout preview remains authority. This read never reserves usage or creates a PromotionRedemption. Ordered by endsAt ASC, id ASC. Default/max limit 20.',
  })
  @ApiOkResponse({ type: CustomerDiscoverablePromotionListDto })
  @ApiResponse({
    status: 401,
    description: 'AUTH_INVALID_TOKEN',
  })
  @ApiResponse({
    status: 404,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
  })
  listDiscoverable(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: CustomerPromotionListQueryDto,
  ) {
    return this.promotions.listDiscoverableForCustomer(
      principal.accountId,
      new Date(),
      query.limit ?? CUSTOMER_PROMOTION_DISCOVERY_DEFAULT_LIMIT,
    );
  }
}
