import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import { MerchantOrderService } from '../../application/merchant-order.service';
import { ORDER_ERROR_CODES } from '../../domain/order.errors';
import {
  MerchantOrderDetailResponseDto,
  MerchantOrderListResponseDto,
} from './dto/merchant-order-response.dto';
import {
  ListMerchantOrdersQueryDto,
  MerchantOrderActionDto,
  RejectMerchantOrderDto,
} from './dto/merchant-order-write.dto';

@ApiTags('merchant-orders')
@ApiBearerAuth()
@Controller('merchant/:merchantId/orders')
export class MerchantOrderController {
  constructor(private readonly merchantOrders: MerchantOrderService) {}

  @Get()
  @ApiOperation({
    summary: 'List Orders for a Merchant the Account is a member of',
    description: [
      'merchantId is selection context only. Access requires a live MerchantMember row. Multi-Merchant Accounts must call the intended merchantId; the first membership is never inferred.',
      'OWNER, MANAGER, and STAFF may read. SUSPENDED Merchants may still read. Unbounded history is not returned (default limit 50, max 100, newest first).',
      'Optional filters: branchId (owned Branch only), orderStatus, fulfillmentStatus. Driver, refund, and payment-provider filters are not part of this foundation.',
      'Responses use historical Order snapshots. Merchant financial fields exclude driver remuneration and SpeedyGo delivery share. Reads never mutate workflow.',
    ].join(' '),
  })
  @ApiOkResponse({ type: MerchantOrderListResponseDto })
  @ApiResponse({
    status: 404,
    description: `${MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND} or ${MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND}`,
  })
  list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Query() query: ListMerchantOrdersQueryDto,
  ) {
    return this.merchantOrders.listOrders(principal.accountId, merchantId, {
      limit: query.limit,
      offset: query.offset,
      branchId: query.branchId,
      orderStatus: query.orderStatus,
      fulfillmentStatus: query.fulfillmentStatus,
    });
  }

  @Get(':orderId')
  @ApiOperation({
    summary: 'Get one Order owned by a Branch of the Merchant',
    description:
      'Foreign Merchant Orders return MERCHANT_ORDER_NOT_FOUND without leaking existence. Public reference is not an access-control mechanism. Historical item names/prices are used. Live Catalog is not substituted. Customer Account phone and session data are not returned.',
  })
  @ApiOkResponse({ type: MerchantOrderDetailResponseDto })
  @ApiResponse({
    status: 404,
    description: `${MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND} or ${ORDER_ERROR_CODES.MERCHANT_ORDER_NOT_FOUND}`,
  })
  get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.merchantOrders.getOrder(
      principal.accountId,
      merchantId,
      orderId,
    );
  }

  @Post(':orderId/accept')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accept a Customer-submitted Order',
    description: [
      'OWNER and MANAGER only. STAFF is read-only. Merchant must be ACTIVE with verifiedAt set.',
      'Requires Order.status=CREATED and fulfillmentStatus=PENDING_ACCEPTANCE.',
      'Atomically sets Order CONFIRMED, fulfillment ACCEPTED, confirmedAt, and one MERCHANT_ACCEPTED event (actor MERCHANT).',
      'Repeated accept returns 409 MERCHANT_ORDER_ALREADY_ACCEPTED and does not duplicate events.',
      'Does not reprice the Order, mutate Payment, create Delivery, or execute electronic/COD payment. Acceptance does not make Order ACTIVE.',
      'There is no generic PATCH status endpoint.',
    ].join(' '),
  })
  @ApiOkResponse({ type: MerchantOrderDetailResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 409,
    description: [
      MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
      ORDER_ERROR_CODES.MERCHANT_ORDER_ALREADY_ACCEPTED,
      ORDER_ERROR_CODES.MERCHANT_ORDER_INVALID_TRANSITION,
    ].join(' or '),
  })
  accept(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() _body: MerchantOrderActionDto,
  ) {
    return this.merchantOrders.acceptOrder(
      principal.accountId,
      merchantId,
      orderId,
    );
  }

  @Post(':orderId/reject')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reject a Customer-submitted Order before acceptance',
    description: [
      'OWNER and MANAGER only. Allowed only while CREATED + PENDING_ACCEPTANCE and Payment.status=PENDING.',
      'Atomically sets Order CANCELLED, keeps fulfillment PENDING_ACCEPTANCE, creates one OrderCancellation, one MERCHANT_REJECTED event, and Payment PENDING → CANCELLED.',
      'Does not reactivate the Cart, create Refund, PaymentTransaction, COD, or Delivery. Post-accept or paid-order cancellation belongs to a future Cancellation + Refund workflow (MERCHANT_ORDER_REJECTION_REQUIRES_CANCELLATION_FLOW).',
      'Repeated reject returns 409 MERCHANT_ORDER_NOT_REJECTABLE.',
    ].join(' '),
  })
  @ApiOkResponse({ type: MerchantOrderDetailResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 409,
    description: [
      ORDER_ERROR_CODES.MERCHANT_ORDER_NOT_REJECTABLE,
      ORDER_ERROR_CODES.MERCHANT_ORDER_REJECTION_REQUIRES_CANCELLATION_FLOW,
      MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
    ].join(' or '),
  })
  reject(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: RejectMerchantOrderDto,
  ) {
    return this.merchantOrders.rejectOrder(
      principal.accountId,
      merchantId,
      orderId,
      body.reason,
    );
  }

  @Post(':orderId/start-preparation')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start Merchant preparation',
    description: [
      'OWNER and MANAGER only. Requires Order.status=CONFIRMED and fulfillmentStatus=ACCEPTED.',
      'Atomically sets Order ACTIVE and fulfillment PREPARING. ACTIVE means operational fulfillment has started; it is not Driver assigned, picked up, delivered, or payment completed.',
      'ELECTRONIC Orders require Payment.status=SUCCEEDED (otherwise 409 MERCHANT_ORDER_PAYMENT_NOT_READY). COD may prepare while Payment is PENDING.',
      'Creates one PREPARATION_STARTED event (CONFIRMED → ACTIVE). Invalid or repeated transitions return 409 MERCHANT_ORDER_INVALID_TRANSITION.',
      'Does not reprice, create Delivery, or change Payment.',
    ].join(' '),
  })
  @ApiOkResponse({ type: MerchantOrderDetailResponseDto })
  @ApiResponse({
    status: 409,
    description: [
      MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
      ORDER_ERROR_CODES.MERCHANT_ORDER_INVALID_TRANSITION,
      ORDER_ERROR_CODES.MERCHANT_ORDER_PAYMENT_NOT_READY,
    ].join(' or '),
  })
  startPreparation(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() _body: MerchantOrderActionDto,
  ) {
    return this.merchantOrders.startPreparation(
      principal.accountId,
      merchantId,
      orderId,
    );
  }

  @Post(':orderId/mark-ready')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark the Order ready for later Delivery workflow',
    description: [
      'OWNER and MANAGER only. Requires Order.status=ACTIVE and fulfillmentStatus=PREPARING.',
      'Moves fulfillment PREPARING → READY. Order.status remains ACTIVE. READY means Merchant preparation is finished and the Order is ready for a later Delivery Foundation. It does not mean Delivery created, Driver assigned, picked up, or delivered.',
      'Creates one ORDER_READY event (fromStatus=ACTIVE, toStatus=ACTIVE). No Delivery row is created.',
      'Does not reprice or execute payment. COD Payment may remain PENDING.',
    ].join(' '),
  })
  @ApiOkResponse({ type: MerchantOrderDetailResponseDto })
  markReady(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() _body: MerchantOrderActionDto,
  ) {
    return this.merchantOrders.markReady(
      principal.accountId,
      merchantId,
      orderId,
    );
  }
}
