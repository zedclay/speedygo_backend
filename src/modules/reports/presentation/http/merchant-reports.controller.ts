import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { MERCHANT_ERROR_CODES } from '../../../merchants/domain/merchant.errors';
import { MerchantDailySummaryService } from '../../application/merchant-daily-summary.service';
import { MerchantSalesReportService } from '../../application/merchant-sales-report.service';
import { REPORTS_ERROR_CODES } from '../../domain/reports.errors';
import {
  MerchantDailySummaryQueryDto,
  MerchantReportQueryDto,
  MerchantTopProductsQueryDto,
} from './dto/merchant-reports.dto';

@ApiTags('merchant-reports')
@ApiBearerAuth()
@Controller('merchant/:merchantId/reports')
export class MerchantReportsController {
  constructor(
    private readonly reports: MerchantSalesReportService,
    private readonly dailySummary: MerchantDailySummaryService,
  ) {}

  @Get('daily-summary')
  @ApiOperation({
    summary: 'Merchant operational daily summary for one Africa/Algiers day',
    description: [
      'Any MerchantMember (OWNER/MANAGER/STAFF) may read counts, preparation timing, cancellation motifs and merchandise sales. Commission and net are never returned.',
      'Window is local midnight inclusive to next local midnight exclusive. date defaults to today and must not be after today.',
      'Sales = COMPLETED Orders by completedAt valued from the immutable OrderFinancialSnapshot; dataStatus=MISSING_FINANCIAL_SNAPSHOT withholds money (null), never zero.',
      'averageActualPreparationMinutes and onTimePreparationRateBps are null without samples (never 0). No target, growth or delivery-delay minutes are returned.',
      'cancellationReasons groups OrderCancellation.reasonCode (null → UNSET) by cancelledAt in the window.',
    ].join(' '),
  })
  @ApiResponse({
    status: 400,
    description: REPORTS_ERROR_CODES.REPORTS_INVALID_INPUT,
  })
  @ApiResponse({
    status: 404,
    description: `${MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND} or ${MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND}`,
  })
  daily(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Query() query: MerchantDailySummaryQueryDto,
  ) {
    return this.dailySummary.getDailySummary(principal.accountId, merchantId, {
      date: query.date,
      branchId: query.branchId,
    });
  }

  @Get('sales')
  @ApiOperation({
    summary: 'Merchant sales summary and trend for an Africa/Algiers period',
    description: [
      'Any MerchantMember (OWNER/MANAGER/STAFF) may read counts, merchandise sales and the trend. Commission, merchant net and refund adjustments require OWNER/MANAGER (financeAccess=ROLE_RESTRICTED, finance=null for STAFF).',
      'Sales = COMPLETED Orders by Order.completedAt in [from, to), valued from the immutable OrderFinancialSnapshot (historical commission rate, never today’s rule). Cancelled Orders are counted separately by OrderCancellation.cancelledAt and never add to sales.',
      'Refunds do not reduce sales; recordedRefundAdjustmentsMinor is the signed sum of REFUND_ADJUSTMENT settlement lines (−merchant liability) for REFUNDED refunds completed in the period.',
      'dataStatus=MISSING_FINANCIAL_SNAPSHOT withholds money fields (null) instead of reporting zero.',
    ].join(' '),
  })
  @ApiResponse({
    status: 400,
    description: REPORTS_ERROR_CODES.REPORTS_INVALID_INPUT,
  })
  @ApiResponse({
    status: 404,
    description: `${MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND} or ${MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND}`,
  })
  sales(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Query() query: MerchantReportQueryDto,
  ) {
    return this.reports.getSalesSummary(principal.accountId, merchantId, {
      period: query.period,
      from: query.from,
      to: query.to,
      branchId: query.branchId,
    });
  }

  @Get('top-products')
  @ApiOperation({
    summary: 'Top products from historical OrderItem rows of COMPLETED Orders',
    description:
      'Any MerchantMember may read. Groups by productId (or by historical name when the Product was deleted). orderCount = distinct Orders, quantity = SUM(OrderItem.quantity), revenueMinor = SUM(OrderItem.lineTotalMinor) (merchandise incl. options, before commission). sort=ORDERS (default) or REVENUE; deterministic tie-breaks.',
  })
  @ApiResponse({
    status: 400,
    description: REPORTS_ERROR_CODES.REPORTS_INVALID_INPUT,
  })
  @ApiResponse({
    status: 404,
    description: `${MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND} or ${MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND}`,
  })
  topProducts(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Query() query: MerchantTopProductsQueryDto,
  ) {
    return this.reports.getTopProducts(principal.accountId, merchantId, {
      period: query.period,
      from: query.from,
      to: query.to,
      branchId: query.branchId,
      sort: query.sort,
      limit: query.limit,
    });
  }
}
