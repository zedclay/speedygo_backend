import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
  ) {
    return this.commands.create(admin, body);
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
