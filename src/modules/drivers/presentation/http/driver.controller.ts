import {
  Body,
  Controller,
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
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { DriverService } from '../../application/driver.service';
import { DRIVER_ERROR_CODES } from '../../domain/driver.errors';
import { DRIVER_DOCUMENT_TYPES } from '../../domain/driver.policy';
import {
  DriverMeResponseDto,
  DriverProfileResponseDto,
  DriverVehicleResponseDto,
} from './dto/driver-response.dto';
import {
  CreateDriverProfileDto,
  CreateDriverVehicleDto,
  UpdateDriverProfileDto,
  UpdateDriverVehicleDto,
  UpsertDriverDocumentDto,
} from './dto/driver-write.dto';

@ApiTags('driver')
@ApiBearerAuth()
@Controller('driver')
export class DriverController {
  constructor(private readonly drivers: DriverService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Driver bootstrap for the authenticated Account',
    description: [
      'Never creates a DriverProfile. Returns driverProfileExists=false when onboarding has not started.',
      'Does not 404 solely because the profile is missing. Reads never mutate onboarding.',
      'Does not include Account OTP phone, document fileUrl/object keys, earnings, or Deliveries.',
      'matchingEligible is the future Driver Matching gate and does not search for work.',
    ].join(' '),
  })
  @ApiOkResponse({ type: DriverMeResponseDto })
  getMe(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.drivers.getMe(principal.accountId);
  }

  @Post('profile')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create DriverProfile for the authenticated Account',
    description:
      'Body is fullName only. verificationStatus starts UNVERIFIED. DriverAvailability is created OFFLINE in the same transaction. Duplicate create is DRIVER_PROFILE_ALREADY_EXISTS. status, approvedAt, availability, and earnings are not client-writable.',
  })
  @ApiCreatedResponse({ type: DriverProfileResponseDto })
  @ApiResponse({
    status: 409,
    description: DRIVER_ERROR_CODES.DRIVER_PROFILE_ALREADY_EXISTS,
  })
  createProfile(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: CreateDriverProfileDto,
  ) {
    return this.drivers.createProfile(principal.accountId, {
      fullName: body.fullName,
    });
  }

  @Patch('profile')
  @ApiOperation({
    summary: 'Partial update of the authenticated DriverProfile',
    description:
      'fullName only, and only while UNVERIFIED or REJECTED. PENDING_REVIEW, APPROVED, and SUSPENDED are locked.',
  })
  @ApiOkResponse({ type: DriverProfileResponseDto })
  @ApiResponse({
    status: 404,
    description: DRIVER_ERROR_CODES.DRIVER_PROFILE_NOT_FOUND,
  })
  updateProfile(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: UpdateDriverProfileDto,
  ) {
    return this.drivers.updateProfile(principal.accountId, {
      fullName: body.fullName,
    });
  }

  @Put('documents/:type')
  @ApiParam({ name: 'type', enum: DRIVER_DOCUMENT_TYPES })
  @ApiOperation({
    summary: 'Register identity or driving-license metadata',
    description: [
      'Does not upload files. StorageModule has no S3 wiring. fileUrl is a server-generated opaque object key and is never returned.',
      'Client cannot send fileUrl or status. DRIVING_LICENSE requires a future expiryDate (YYYY-MM-DD). IDENTITY expiryDate is optional; if present it must not be expired.',
      'Replaceable while UNVERIFIED or REJECTED. Locked in PENDING_REVIEW, APPROVED, and SUSPENDED.',
    ].join(' '),
  })
  @ApiOkResponse({ type: DriverMeResponseDto })
  upsertDocument(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('type') type: string,
    @Body() body: UpsertDriverDocumentDto,
  ) {
    return this.drivers.upsertDocument(principal.accountId, {
      type,
      expiryDate: body.expiryDate ?? null,
    });
  }

  @Post('vehicles')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a vehicle and make it the ACTIVE vehicle',
    description:
      'v1.0 keeps exactly one ACTIVE vehicle per Driver by deactivating previous ACTIVE rows. ACTIVE plate numbers are globally unique (partial unique index). status is server-managed.',
  })
  @ApiCreatedResponse({ type: DriverVehicleResponseDto })
  @ApiResponse({
    status: 409,
    description: DRIVER_ERROR_CODES.DRIVER_VEHICLE_CONFLICT,
  })
  createVehicle(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: CreateDriverVehicleDto,
  ) {
    return this.drivers.createVehicle(principal.accountId, {
      type: body.type,
      plateNumber: body.plateNumber,
      model: body.model,
      color: body.color ?? null,
    });
  }

  @Patch('vehicles/:vehicleId')
  @ApiOperation({
    summary: 'Update an owned vehicle',
    description:
      'type, plateNumber, model, color only while UNVERIFIED or REJECTED. Cross-account ids return DRIVER_VEHICLE_NOT_FOUND.',
  })
  @ApiOkResponse({ type: DriverVehicleResponseDto })
  updateVehicle(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() body: UpdateDriverVehicleDto,
  ) {
    return this.drivers.updateVehicle(principal.accountId, vehicleId, {
      type: body.type,
      plateNumber: body.plateNumber,
      model: body.model,
      color: body.color,
    });
  }

  @Post('verification/submit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Submit Driver onboarding for review',
    description: [
      'Requires complete profile, IDENTITY metadata, unexpired DRIVING_LICENSE metadata, and an ACTIVE vehicle.',
      'UNVERIFIED or REJECTED → PENDING_REVIEW. Repeated submit from PENDING_REVIEW is conflict.',
      'Driver cannot self-approve, self-reject, or self-suspend. No Admin HTTP in this foundation.',
    ].join(' '),
  })
  @ApiOkResponse({ type: DriverMeResponseDto })
  @ApiResponse({
    status: 409,
    description: [
      DRIVER_ERROR_CODES.DRIVER_ONBOARDING_INCOMPLETE,
      DRIVER_ERROR_CODES.DRIVER_VERIFICATION_INVALID_STATE,
    ].join(' or '),
  })
  submitVerification(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.drivers.submitVerification(principal.accountId);
  }

  @Post('availability/go-online')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set Driver availability ONLINE',
    description: [
      'Requires APPROVED verification, operational readiness, and current OFFLINE availability.',
      'Persisting ONLINE does not require live GPS and does not mean the Driver can enter a geo search pool. Future Matching must require fresh valid location.',
      'Does not write DriverLiveLocation, Redis GEO, Delivery, or DriverAssignment.',
      'REJECTED and SUSPENDED Drivers cannot go online.',
    ].join(' '),
  })
  @ApiOkResponse({ type: DriverMeResponseDto })
  goOnline(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.drivers.goOnline(principal.accountId);
  }

  @Post('availability/go-offline')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set Driver availability OFFLINE',
    description:
      'ONLINE → OFFLINE when the Driver has no unreleased ACCEPTED assignment. ONLINE → OFFLINE_AFTER_CURRENT_DELIVERY when an accepted assignment is current. That state stays excluded from new matching offers.',
  })
  @ApiOkResponse({ type: DriverMeResponseDto })
  goOffline(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.drivers.goOffline(principal.accountId);
  }
}
