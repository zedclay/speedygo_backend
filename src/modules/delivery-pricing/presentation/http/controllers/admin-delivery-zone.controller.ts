import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { ADMIN_PERMISSIONS } from '../../../../admin/domain/admin-permissions';
import type { CurrentAdminContext } from '../../../../admin/domain/admin.types';
import { AdminGuard } from '../../../../admin/presentation/guards/admin.guard';
import { CurrentAdmin } from '../../../../admin/presentation/decorators/current-admin.decorator';
import { AdminEmptyBodyDto } from '../../../../admin/presentation/http/dto/admin.dto';
import { AdminDeliveryZoneCommandsService } from '../../../application/admin-delivery-zone-commands.service';
import { DeliveryZoneRepository } from '../../../infrastructure/delivery-zone.repository';
import { normalizeListQuery } from '../../../../admin/domain/admin.policy';
import {
  AdminDeliveryZoneListQueryDto,
  CreateAdminDeliveryZoneDto,
  UpdateAdminDeliveryZoneDto,
} from '../dto/admin-delivery.dto';
import type { DeliveryZoneRecord } from '../../../domain/delivery-pricing.types';

function serializeZone(zone: DeliveryZoneRecord): Record<string, unknown> {
  return {
    id: zone.id,
    name: zone.name,
    geometry: JSON.parse(zone.geometryGeoJson) as unknown,
    active: zone.active,
    createdAt: zone.createdAt,
    updatedAt: zone.updatedAt,
  };
}

@ApiTags('admin-delivery-zones')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/delivery/zones')
export class AdminDeliveryZoneController {
  constructor(
    private readonly zoneRepo: DeliveryZoneRepository,
    private readonly commands: AdminDeliveryZoneCommandsService,
  ) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.DELIVERY_ZONES_READ)
  @ApiOperation({ summary: 'List delivery zones' })
  async list(@Query() query: AdminDeliveryZoneListQueryDto) {
    const { limit, offset } = normalizeListQuery(query);
    const result = await this.zoneRepo.list({
      limit,
      offset,
      active: query.active,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
    return {
      items: result.items.map(serializeZone),
      total: result.total,
      limit,
      offset,
    };
  }

  @Get(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.DELIVERY_ZONES_READ)
  @ApiOperation({ summary: 'Get delivery zone by id' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const zone = await this.zoneRepo.requireById(id);
    return serializeZone(zone);
  }

  @Post()
  @RequirePermissions(ADMIN_PERMISSIONS.DELIVERY_ZONES_MANAGE)
  @ApiOperation({ summary: 'Create delivery zone' })
  async create(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Body() body: CreateAdminDeliveryZoneDto,
  ) {
    const zone = await this.commands.create(admin, {
      name: body.name,
      rawGeometry: body.geometry,
    });
    return serializeZone(zone);
  }

  @Put(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.DELIVERY_ZONES_MANAGE)
  @ApiOperation({ summary: 'Update delivery zone name and/or geometry' })
  async update(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminDeliveryZoneDto,
  ) {
    const zone = await this.commands.update(admin, {
      id,
      name: body.name,
      rawGeometry: body.geometry,
    });
    return serializeZone(zone);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(ADMIN_PERMISSIONS.DELIVERY_ZONES_MANAGE)
  @ApiOperation({ summary: 'Activate delivery zone' })
  async activate(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    const zone = await this.commands.activate(admin, id);
    return serializeZone(zone);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(ADMIN_PERMISSIONS.DELIVERY_ZONES_MANAGE)
  @ApiOperation({ summary: 'Deactivate delivery zone' })
  async deactivate(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    const zone = await this.commands.deactivate(admin, id);
    return serializeZone(zone);
  }
}
