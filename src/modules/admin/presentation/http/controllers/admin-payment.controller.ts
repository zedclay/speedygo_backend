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

@ApiTags('admin-payments')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/payments')
export class AdminPaymentController {
  constructor(private readonly queries: AdminQueryRepository) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENTS_READ)
  @ApiOperation({
    summary: 'List payments',
    description: 'No provider secrets or checkout URLs.',
  })
  list(@Query() query: AdminStatusListQueryDto) {
    return this.queries.listPayments(query);
  }

  @Get(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENTS_READ)
  @ApiOperation({ summary: 'Payment detail (no secrets)' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.getPayment(id);
  }
}
