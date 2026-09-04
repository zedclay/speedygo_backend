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
}
