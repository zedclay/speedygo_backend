import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { AdminOrderCommandsService } from '../../../application/admin-order-commands.service';
import { ADMIN_PERMISSIONS } from '../../../domain/admin-permissions';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { AdminQueryRepository } from '../../../infrastructure/admin-query.repository';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import { AdminGuard } from '../../guards/admin.guard';
import {
  AdminAssignOfferDto,
  AdminCancelOrderDto,
  AdminOrderListQueryDto,
} from '../dto/admin.dto';

@ApiTags('admin-orders')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/orders')
export class AdminOrderController {
  constructor(
    private readonly queries: AdminQueryRepository,
    private readonly commands: AdminOrderCommandsService,
  ) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.ORDERS_READ)
  @ApiOperation({
    summary: 'List orders (operational summary)',
    description:
      'Optional customerId / merchantId / merchantBranchId filters are applied server-side before pagination. merchantId expands to all branches.',
  })
  list(@Query() query: AdminOrderListQueryDto) {
    return this.queries.listOrders(query);
  }

  @Get(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.ORDERS_READ)
  @ApiOperation({
    summary: 'Order detail',
    description:
      'Additive detail: items, optional financial snapshot (null when missing — never fabricated), delivery address, payment summary, customer/merchant/driver parties, delivery summary, and timeline merged from OrderStatusEvent + DeliveryEvent (persisted occurredAt only).',
  })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.getOrder(id);
  }

  @Post(':id/assign-offer')
  @HttpCode(200)
  @RequirePermissions(ADMIN_PERMISSIONS.ORDERS_ASSIGN)
  @ApiOperation({
    summary: 'Admin offer-only driver assign (A044 / A045′)',
    description:
      'Creates DriverAssignment OFFERED for the chosen Driver while Delivery is SEARCHING_DRIVER. Supersedes an open offer as EXPIRED. Never auto-accepts. Waives GEO/freshness at offer time; Driver accept rechecks. Not implied by orders.read.',
  })
  assignOffer(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminAssignOfferDto,
  ) {
    return this.commands.assignOffer(admin, id, body.driverId, body.reason);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(ADMIN_PERMISSIONS.ORDERS_CANCEL)
  @ApiOperation({
    summary: 'Admin early-window order cancel (A047)',
    description:
      'Same window as Customer cancel: CREATED + PENDING_ACCEPTANCE, no non-terminal Delivery, no CodCollection. Actor ADMIN. Cancel ≠ refund. Not implied by orders.read.',
  })
  cancel(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminCancelOrderDto,
  ) {
    return this.commands.cancelEarly(admin, id, body.reason);
  }
}
