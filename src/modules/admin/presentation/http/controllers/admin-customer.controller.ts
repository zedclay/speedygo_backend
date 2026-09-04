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
import { AdminListQueryDto } from '../dto/admin.dto';

@ApiTags('admin-customers')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/customers')
export class AdminCustomerController {
  constructor(private readonly queries: AdminQueryRepository) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.CUSTOMERS_READ)
  @ApiOperation({
    summary: 'List customers',
    description: 'Safe CustomerProfile fields only — no OTP/sessions.',
  })
  list(@Query() query: AdminListQueryDto) {
    return this.queries.listCustomers(query);
  }

  @Get(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.CUSTOMERS_READ)
  @ApiOperation({ summary: 'Customer detail (safe fields)' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.getCustomer(id);
  }
}
