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
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CustomerAddressService } from '../../application/customer-address.service';
import { CustomerProfileService } from '../../application/customer-profile.service';
import { CUSTOMER_ERROR_CODES } from '../../domain/customer.errors';
import {
  CustomerAddressListResponseDto,
  CustomerAddressResponseDto,
  CustomerDeletedResponseDto,
  CustomerMeResponseDto,
  CustomerProfileResponseDto,
} from './dto/customer-response.dto';
import {
  CreateCustomerAddressDto,
  CreateCustomerProfileDto,
  UpdateCustomerAddressDto,
  UpdateCustomerProfileDto,
} from './dto/customer-write.dto';

@ApiTags('customer')
@ApiBearerAuth()
@Controller('customer')
export class CustomerController {
  constructor(
    private readonly profiles: CustomerProfileService,
    private readonly addresses: CustomerAddressService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Customer bootstrap for the authenticated Account',
    description:
      'Never creates a CustomerProfile. Returns customerProfileExists=false when onboarding has not started. Does not return 404 solely because the profile is missing. profileComplete is sufficient for Home; addressReady is independent.',
  })
  @ApiOkResponse({ type: CustomerMeResponseDto })
  getMe(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.profiles.getMe(principal.accountId);
  }

  @Post('profile')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create CustomerProfile for the authenticated Account',
    description:
      'Explicit onboarding. Body is fullName only. avatarUrl is not client-writable. Duplicate create is CUSTOMER_PROFILE_ALREADY_EXISTS (not a silent update). Ownership is always AuthenticatedPrincipal.accountId.',
  })
  @ApiCreatedResponse({ type: CustomerProfileResponseDto })
  @ApiResponse({
    status: 409,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_ALREADY_EXISTS,
  })
  createProfile(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: CreateCustomerProfileDto,
  ) {
    return this.profiles.create(principal.accountId, {
      fullName: body.fullName,
    });
  }

  @Patch('profile')
  @ApiOperation({
    summary: 'Partial update of the authenticated CustomerProfile',
    description:
      'Unknown fields are rejected. id, accountId, avatarUrl, createdAt, and updatedAt are not writable. Phone and email are Account identity fields, not CustomerProfile fields.',
  })
  @ApiOkResponse({ type: CustomerProfileResponseDto })
  @ApiResponse({
    status: 404,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
  })
  updateProfile(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: UpdateCustomerProfileDto,
  ) {
    return this.profiles.update(principal.accountId, {
      fullName: body.fullName,
    });
  }

  @Get('addresses')
  @ApiOperation({
    summary: 'List addresses owned by the authenticated Customer',
  })
  @ApiOkResponse({ type: CustomerAddressListResponseDto })
  @ApiResponse({
    status: 404,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
  })
  listAddresses(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.addresses.list(principal.accountId);
  }

  @Post('addresses')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create an address for the authenticated Customer',
    description:
      'The first address is always default, even if isDefault=false is sent. Later addresses never replace the current default; switch with PUT /addresses/:addressId/default. Coordinates are validated globally, not against an Algeria bounding box.',
  })
  @ApiCreatedResponse({ type: CustomerAddressResponseDto })
  @ApiResponse({
    status: 404,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
  })
  createAddress(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: CreateCustomerAddressDto,
  ) {
    return this.addresses.create(principal.accountId, {
      label: body.label,
      addressText: body.addressText,
      latitude: body.latitude,
      longitude: body.longitude,
    });
  }

  @Patch('addresses/:addressId')
  @ApiOperation({
    summary: 'Partial update of an owned address',
    description:
      'isDefault is not writable here. Use PUT /addresses/:addressId/default. Cross-account ids return CUSTOMER_ADDRESS_NOT_FOUND.',
  })
  @ApiOkResponse({ type: CustomerAddressResponseDto })
  @ApiResponse({
    status: 404,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_ADDRESS_NOT_FOUND,
  })
  updateAddress(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
    @Body() body: UpdateCustomerAddressDto,
  ) {
    return this.addresses.update(principal.accountId, addressId, {
      label: body.label,
      addressText: body.addressText,
      latitude: body.latitude,
      longitude: body.longitude,
    });
  }

  @Delete('addresses/:addressId')
  @ApiOperation({
    summary: 'Hard-delete an owned address',
    description:
      'Schema has no deletedAt. Historical orders use order_delivery_address_snapshots, not the live Address row. Deleting the default address does not auto-assign another default.',
  })
  @ApiOkResponse({ type: CustomerDeletedResponseDto })
  @ApiResponse({
    status: 404,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_ADDRESS_NOT_FOUND,
  })
  deleteAddress(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
  ) {
    return this.addresses.remove(principal.accountId, addressId);
  }

  @Put('addresses/:addressId/default')
  @ApiOperation({
    summary: 'Set an owned address as the single default',
    description:
      'Atomic: clear the current default, then set the requested owned address. Enforced by partial unique index addresses_one_default_per_customer.',
  })
  @ApiOkResponse({ type: CustomerAddressResponseDto })
  @ApiResponse({
    status: 404,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_ADDRESS_NOT_FOUND,
  })
  @ApiResponse({
    status: 409,
    description: CUSTOMER_ERROR_CODES.CUSTOMER_DEFAULT_ADDRESS_INVALID,
  })
  setDefaultAddress(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
  ) {
    return this.addresses.setDefault(principal.accountId, addressId);
  }
}
