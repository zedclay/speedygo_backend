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
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { CUSTOMER_ERROR_CODES } from '../../../customers/domain/customer.errors';
import { CartService } from '../../application/cart.service';
import { CART_ERROR_CODES } from '../../domain/cart.errors';
import {
  CartBootstrapResponseDto,
  CartResponseDto,
} from './dto/cart-response.dto';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart-write.dto';

@ApiTags('cart')
@ApiBearerAuth()
@Controller('customer/cart')
export class CartController {
  constructor(private readonly carts: CartService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the Active Cart for the authenticated Customer',
    description:
      'Requires CustomerProfile. Does not create a Cart. Prices are live integer minor units from Product.priceMinor plus selected ProductOption.additionalPriceMinor. Totals exclude delivery fees and discounts. Persisted option selections are returned.',
  })
  @ApiOkResponse({ type: CartBootstrapResponseDto })
  @ApiResponse({
    status: 404,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
  })
  getCart(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.carts.getCart(principal.accountId);
  }

  @Post('items')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Add a Product to the Active Cart',
    description:
      'Creates an Active Cart lazily on the Product Branch. Same Product plus the same normalized option set increases quantity. A different option set creates a separate CartItem. A different Branch returns CART_BRANCH_MISMATCH without clearing the Cart. Client cannot send prices. optionIds are validated live and persisted as CartItemOption rows.',
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiResponse({
    status: 400,
    description: `${CART_ERROR_CODES.CART_INVALID_QUANTITY} or ${CART_ERROR_CODES.CART_REQUIRED_OPTION_MISSING} or ${CART_ERROR_CODES.CART_OPTION_INVALID}`,
  })
  @ApiResponse({
    status: 409,
    description: `${CART_ERROR_CODES.CART_BRANCH_MISMATCH} or ${CART_ERROR_CODES.CART_PRODUCT_NOT_AVAILABLE} or ${CART_ERROR_CODES.CART_OPTION_NOT_AVAILABLE}`,
  })
  addItem(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: AddCartItemDto,
  ) {
    return this.carts.addItem(principal.accountId, {
      productId: body.productId,
      quantity: body.quantity,
      optionIds: body.optionIds ?? [],
    });
  }

  @Patch('items/:cartItemId')
  @ApiOperation({
    summary: 'Update quantity and/or option selection of an owned CartItem',
    description:
      'Foreign CartItem ids return CART_ITEM_NOT_FOUND. When optionIds is sent, the full configuration is validated then replaced atomically. Invalid replacement leaves the previous selection unchanged.',
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiResponse({
    status: 404,
    description: CART_ERROR_CODES.CART_ITEM_NOT_FOUND,
  })
  updateItem(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('cartItemId', new ParseUUIDPipe()) cartItemId: string,
    @Body() body: UpdateCartItemDto,
  ) {
    return this.carts.updateItem(principal.accountId, cartItemId, {
      quantity: body.quantity,
      optionIds: body.optionIds,
    });
  }

  @Delete('items/:cartItemId')
  @ApiOperation({
    summary: 'Remove an owned CartItem',
    description:
      'Selected CartItemOption rows CASCADE. Removing the final item deletes the Active Cart and releases its Branch context.',
  })
  @ApiOkResponse({ type: CartBootstrapResponseDto })
  @ApiResponse({
    status: 404,
    description: CART_ERROR_CODES.CART_ITEM_NOT_FOUND,
  })
  removeItem(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('cartItemId', new ParseUUIDPipe()) cartItemId: string,
  ) {
    return this.carts.removeItem(principal.accountId, cartItemId);
  }

  @Delete()
  @ApiOperation({
    summary: 'Clear the Active Cart',
    description:
      'Deletes the Active Cart row. CartItems and CartItemOptions CASCADE. Next Add Item may target another Branch. Does not create Orders.',
  })
  @ApiOkResponse({ type: CartBootstrapResponseDto })
  clearCart(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.carts.clearCart(principal.accountId);
  }
}
