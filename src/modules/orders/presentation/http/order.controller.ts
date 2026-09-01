import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { CUSTOMER_ERROR_CODES } from '../../../customers/domain/customer.errors';
import { OrderService } from '../../application/order.service';
import { ORDER_ERROR_CODES } from '../../domain/order.errors';
import {
  OrderDetailResponseDto,
  OrderListResponseDto,
} from './dto/order-response.dto';
import { CreateOrderDto, ListOrdersQueryDto } from './dto/order-write.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('customer/orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an Order from the Active Cart',
    description: [
      'Order creation is the immutable historical commit boundary. It does not trust a previous GET Cart or Checkout Preview.',
      'Request body: addressId, paymentMethod (COD or ELECTRONIC), expectedMerchandiseSubtotalMinor, expectedDeliveryFeeMinor, expectedCustomerTotalMinor.',
      'Expected amounts are Customer confirmation values from the latest Checkout Preview only. The Backend recalculates all authoritative merchandise, Delivery Fee, commission, and customerPayableMinor values inside the same transaction.',
      'Public expectedCustomerTotalMinor maps to internal customerPayableMinor for comparison only. Expected amounts never become price authority and are never written to Payment.amountMinor.',
      'If live amounts differ from confirmed expected amounts, the request returns 409 ORDER_RECONFIRMATION_REQUIRED with changes[] and current { merchandiseSubtotalMinor, deliveryFeeMinor, customerTotalMinor }. Nothing is persisted. The ACTIVE Cart remains ACTIVE.',
      'Rejected mass-assignment includes cartId, customerId, accountId, merchantId, merchantBranchId, zoneId, pricingRuleId, commissionRuleId, productId, prices, authoritative totals, expectedCustomerPayableMinor, status, fulfillmentStatus, commission, discounts, tax, tip, promoCode, and serviceFee.',
      'On success: Order status CREATED, fulfillment PENDING_ACCEPTANCE, one ORDER_CREATED event, Payment PENDING intent (no PaymentTransaction), no Delivery, ACTIVE Cart converted to CONVERTED. Historical Order values are immutable after commit.',
    ].join(' '),
  })
  @ApiCreatedResponse({ type: OrderDetailResponseDto })
  @ApiResponse({
    status: 400,
    description: `${ORDER_ERROR_CODES.ORDER_ADDRESS_COORDINATES_REQUIRED} or ${ORDER_ERROR_CODES.ORDER_PAYMENT_METHOD_INVALID} or ${ORDER_ERROR_CODES.ORDER_EXPECTED_AMOUNTS_INVALID}`,
  })
  @ApiResponse({
    status: 404,
    description: `${CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND} or ${ORDER_ERROR_CODES.ORDER_ADDRESS_NOT_FOUND}`,
  })
  @ApiResponse({
    status: 409,
    description: [
      ORDER_ERROR_CODES.ORDER_CART_REQUIRED,
      ORDER_ERROR_CODES.ORDER_CART_NOT_READY,
      ORDER_ERROR_CODES.ORDER_ADDRESS_OUTSIDE_ZONE,
      ORDER_ERROR_CODES.ORDER_DELIVERY_ZONE_AMBIGUOUS,
      ORDER_ERROR_CODES.ORDER_PRICING_RULE_NOT_FOUND,
      ORDER_ERROR_CODES.ORDER_PRICING_CONFIGURATION_INVALID,
      ORDER_ERROR_CODES.ORDER_MERCHANT_NOT_OPERATIONAL,
      ORDER_ERROR_CODES.ORDER_BRANCH_NOT_OPERATIONAL,
      ORDER_ERROR_CODES.ORDER_ALREADY_CREATED,
      ORDER_ERROR_CODES.ORDER_FINANCIAL_CONFIGURATION_INVALID,
      ORDER_ERROR_CODES.ORDER_RECONFIRMATION_REQUIRED,
    ].join(' or '),
  })
  create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: CreateOrderDto,
  ) {
    return this.orders.createOrder(principal.accountId, {
      addressId: body.addressId,
      paymentMethod: body.paymentMethod,
      expectedMerchandiseSubtotalMinor: body.expectedMerchandiseSubtotalMinor,
      expectedDeliveryFeeMinor: body.expectedDeliveryFeeMinor,
      expectedCustomerTotalMinor: body.expectedCustomerTotalMinor,
    });
  }

  @Get()
  @ApiOperation({
    summary: 'List the authenticated Customer’s Orders',
    description:
      'Paginated, newest first. Returns historical Customer-visible amounts only. Foreign Customers cannot list these Orders. Unbounded history is not returned.',
  })
  @ApiOkResponse({ type: OrderListResponseDto })
  @ApiResponse({
    status: 404,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
  })
  list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: ListOrdersQueryDto,
  ) {
    return this.orders.listOrders(principal.accountId, {
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get(':orderId')
  @ApiOperation({
    summary: 'Get one Order owned by the authenticated Customer',
    description:
      'Returns historical Order, OrderItem, OrderItemOption, Address snapshot, Customer-visible financial amounts, and status. Live Catalog values are not substituted. A foreign orderId returns ORDER_NOT_FOUND without leaking existence. Public reference is not an access-control mechanism.',
  })
  @ApiOkResponse({ type: OrderDetailResponseDto })
  @ApiResponse({
    status: 404,
    description: `${CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND} or ${ORDER_ERROR_CODES.ORDER_NOT_FOUND}`,
  })
  get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.orders.getOrder(principal.accountId, orderId);
  }
}
