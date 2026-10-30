import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { resolveWriteCentimes } from '../../../../../common/money/resolve-money-write';
import {
  PROMOTION_TYPE_MERCHANT_FIXED_MINOR,
  PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR,
} from '../../../../promotions/domain/promotion.types';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { AdminPromotionCommandsService } from '../../../application/admin-promotion-commands.service';
import { ADMIN_PERMISSIONS } from '../../../domain/admin-permissions';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { AdminQueryRepository } from '../../../infrastructure/admin-query.repository';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import { AdminGuard } from '../../guards/admin.guard';
import {
  AdminEmptyBodyDto,
  AdminPromotionListQueryDto,
  CreateAdminPromotionDto,
  UpdateAdminPromotionPresentationDto,
  UpdateAdminPromotionValueDto,
} from '../dto/admin.dto';

@ApiTags('admin-promotions')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/promotions')
export class AdminPromotionController {
  constructor(
    private readonly queries: AdminQueryRepository,
    private readonly commands: AdminPromotionCommandsService,
  ) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.PROMOTIONS_READ)
  @ApiOperation({ summary: 'List promotions' })
  list(@Query() query: AdminPromotionListQueryDto) {
    return this.queries.listPromotions(query);
  }

  @Get(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.PROMOTIONS_READ)
  @ApiOperation({ summary: 'Promotion detail' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.getPromotion(id);
  }

  @Post()
  @RequirePermissions(ADMIN_PERMISSIONS.PROMOTIONS_MANAGE)
  @ApiOperation({ summary: 'Create promotion' })
  create(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Body() body: CreateAdminPromotionDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    const isFixed =
      body.type === PROMOTION_TYPE_MERCHANT_FIXED_MINOR ||
      body.type === PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR;
    if (!isFixed && body.valueAmount != null) {
      throw new BadRequestException(
        'valueAmount is only valid for FIXED promotions under dzd-v2; RATE_BPS uses integer value (bps)',
      );
    }
    const value = isFixed
      ? resolveWriteCentimes({
          headers,
          minorField: body.value,
          dzdField: body.valueAmount,
          fieldLabel: 'valueAmount',
        })
      : body.value;
    if (value === undefined || value === null) {
      throw new BadRequestException(
        'RATE_BPS promotions require integer value (basis points)',
      );
    }
    return this.commands.create(admin, {
      code: body.code,
      type: body.type,
      value,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      active: body.active,
      customerDiscoverable: body.customerDiscoverable,
      customerLabel: body.customerLabel,
    });
  }

  @Post(':id/value')
  @RequirePermissions(ADMIN_PERMISSIONS.PROMOTIONS_MANAGE)
  @ApiOperation({
    summary: 'Replace promotion value',
    description:
      'FIXED dzd-v2: valueAmount DZD majors. RATE_BPS: integer value (bps). Does not change window, funding, or type.',
  })
  async updateValue(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminPromotionValueDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    const current = await this.queries.getPromotion(id);
    const isFixed =
      current.type === PROMOTION_TYPE_MERCHANT_FIXED_MINOR ||
      current.type === PROMOTION_TYPE_SPEEDYGO_FIXED_MINOR;
    if (!isFixed && body.valueAmount != null) {
      throw new BadRequestException(
        'valueAmount is only valid for FIXED promotions under dzd-v2; RATE_BPS uses integer value (bps)',
      );
    }
    const value = isFixed
      ? resolveWriteCentimes({
          headers,
          minorField: body.value,
          dzdField: body.valueAmount,
          fieldLabel: 'valueAmount',
        })
      : body.value;
    if (value === undefined || value === null) {
      throw new BadRequestException(
        'RATE_BPS promotions require integer value (basis points)',
      );
    }
    return this.commands.updateValue(admin, id, value);
  }

  @Post(':id/activate')
  @RequirePermissions(ADMIN_PERMISSIONS.PROMOTIONS_MANAGE)
  @ApiOperation({ summary: 'Activate promotion' })
  activate(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    return this.commands.activate(admin, id);
  }

  @Post(':id/deactivate')
  @RequirePermissions(ADMIN_PERMISSIONS.PROMOTIONS_MANAGE)
  @ApiOperation({ summary: 'Deactivate promotion' })
  deactivate(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    return this.commands.deactivate(admin, id);
  }

  @Post(':id/publish-discovery')
  @RequirePermissions(ADMIN_PERMISSIONS.PROMOTIONS_MANAGE)
  @ApiOperation({
    summary: 'Publish promotion for Customer discovery',
    description:
      'Sets customerDiscoverable=true. Optional customerLabel in the body. Does not change type, value, or window. Discovery is not cart eligibility.',
  })
  publishDiscovery(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminPromotionPresentationDto,
  ) {
    return this.commands.publishDiscovery(admin, id, body.customerLabel);
  }

  @Post(':id/hide-discovery')
  @RequirePermissions(ADMIN_PERMISSIONS.PROMOTIONS_MANAGE)
  @ApiOperation({
    summary: 'Hide promotion from Customer discovery',
    description:
      'Sets customerDiscoverable=false. The offer remains usable at Checkout if still effective.',
  })
  hideDiscovery(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    return this.commands.hideDiscovery(admin, id);
  }

  @Post(':id/presentation')
  @RequirePermissions(ADMIN_PERMISSIONS.PROMOTIONS_MANAGE)
  @ApiOperation({
    summary: 'Update Customer presentation metadata',
    description:
      'Updates customerLabel only. Does not change economics, active, or discoverability.',
  })
  updatePresentation(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminPromotionPresentationDto,
  ) {
    return this.commands.updatePresentation(admin, id, body.customerLabel);
  }
}
