import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ADMIN_PERMISSIONS } from '../../../admin/domain/admin-permissions';
import type { CurrentAdminContext } from '../../../admin/domain/admin.types';
import { CurrentAdmin } from '../../../admin/presentation/decorators/current-admin.decorator';
import { AdminGuard } from '../../../admin/presentation/guards/admin.guard';
import { AdminEmptyBodyDto } from '../../../admin/presentation/http/dto/admin.dto';
import { RequirePermissions } from '../../../authorization/require-permissions.decorator';
import { AdminCommerceVerticalCommandsService } from '../../application/admin-commerce-vertical-commands.service';
import type { CommerceVerticalRecord } from '../../domain/commerce-vertical.types';
import {
  CreateAdminCommerceVerticalDto,
  UpdateAdminCommerceVerticalDto,
} from './dto/admin-commerce-vertical.dto';

function serializeVertical(row: CommerceVerticalRecord) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    iconKey: row.iconKey,
    sortOrder: row.sortOrder,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@ApiTags('admin-commerce-verticals')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/commerce-verticals')
export class AdminCommerceVerticalController {
  constructor(
    private readonly commands: AdminCommerceVerticalCommandsService,
  ) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.COMMERCE_VERTICALS_READ)
  @ApiOperation({ summary: 'List platform commerce categories' })
  async list() {
    const items = await this.commands.list();
    return { items: items.map(serializeVertical) };
  }

  @Post()
  @RequirePermissions(ADMIN_PERMISSIONS.COMMERCE_VERTICALS_MANAGE)
  @ApiOperation({ summary: 'Create a platform commerce category' })
  async create(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Body() body: CreateAdminCommerceVerticalDto,
  ) {
    return serializeVertical(await this.commands.create(admin, body));
  }

  @Patch(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.COMMERCE_VERTICALS_MANAGE)
  @ApiOperation({ summary: 'Update display fields of a commerce category' })
  async update(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminCommerceVerticalDto,
  ) {
    return serializeVertical(await this.commands.update(admin, id, body));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(ADMIN_PERMISSIONS.COMMERCE_VERTICALS_MANAGE)
  @ApiOperation({ summary: 'Activate a commerce category' })
  async activate(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    return serializeVertical(await this.commands.activate(admin, id));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(ADMIN_PERMISSIONS.COMMERCE_VERTICALS_MANAGE)
  @ApiOperation({
    summary: 'Deactivate a commerce category',
    description:
      'Does not delete classifications. Unfiltered customer discovery still includes classified branches.',
  })
  async deactivate(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    return serializeVertical(await this.commands.deactivate(admin, id));
  }
}
