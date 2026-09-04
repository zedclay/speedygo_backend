import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { ADMIN_PERMISSIONS } from '../../../domain/admin-permissions';
import { AdminQueryRepository } from '../../../infrastructure/admin-query.repository';
import { AdminGuard } from '../../guards/admin.guard';
import { AdminStatusListQueryDto } from '../dto/admin.dto';

@ApiTags('admin-orders')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/orders')
export class AdminOrderController {
  constructor(private readonly queries: AdminQueryRepository) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.ORDERS_READ)
  @ApiOperation({ summary: 'List orders (operational summary)' })
  list(@Query() query: AdminStatusListQueryDto) {
    return this.queries.listOrders(query);
  }

  @Get(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.ORDERS_READ)
  @ApiOperation({ summary: 'Order detail (operational summary)' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.getOrder(id);
  }
}
