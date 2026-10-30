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
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { AdminCustomerCommandsService } from '../../../application/admin-customer-commands.service';
import { AdminCustomerNotesService } from '../../../application/admin-customer-notes.service';
import { ADMIN_PERMISSIONS } from '../../../domain/admin-permissions';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { AdminQueryRepository } from '../../../infrastructure/admin-query.repository';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import { AdminGuard } from '../../guards/admin.guard';
import { AdminListQueryDto } from '../dto/admin.dto';

class AdminCustomerLifecycleDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  auditNote?: string;
}

class AdminCustomerNoteCreateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  category!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

@ApiTags('admin-customers')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/customers')
export class AdminCustomerController {
  constructor(
    private readonly queries: AdminQueryRepository,
    private readonly commands: AdminCustomerCommandsService,
    private readonly notes: AdminCustomerNotesService,
  ) {}

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
  @ApiOperation({
    summary: 'Customer detail (safe fields)',
    description:
      'Includes Account.phone, Account.status, and colocated profile flags. No CustomerProfile.status (none exists). No OTP/session secrets.',
  })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.getCustomer(id);
  }

  @Get(':id/addresses')
  @RequirePermissions(ADMIN_PERMISSIONS.CUSTOMERS_READ)
  @ApiOperation({
    summary: 'Customer addresses',
    description:
      'Owned Address rows for the CustomerProfile. 404 when customer missing.',
  })
  listAddresses(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.listCustomerAddresses(id);
  }

  @Get(':id/complaints')
  @RequirePermissions(ADMIN_PERMISSIONS.CUSTOMERS_READ)
  @ApiOperation({
    summary: 'Customer complaints (Support tickets)',
    description:
      'Server-side list of SupportTicket rows where createdByAccountId equals the customer Account. Totals + pagination. No internal notes.',
  })
  listComplaints(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AdminListQueryDto,
  ) {
    return this.queries.listCustomerComplaints(id, query);
  }

  @Get(':id/notes')
  @RequirePermissions(ADMIN_PERMISSIONS.CUSTOMERS_READ)
  @ApiOperation({
    summary: 'List customer internal notes',
    description:
      'Admin-only CustomerInternalNote rows for this CustomerProfile. Never on Customer-facing APIs. Server pagination.',
  })
  listNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AdminListQueryDto,
  ) {
    return this.notes.listNotes(id, query);
  }

  @Post(':id/notes')
  @RequirePermissions(ADMIN_PERMISSIONS.CUSTOMERS_NOTES_MANAGE)
  @ApiOperation({
    summary: 'Add customer internal note',
    description:
      'Author = authenticated AdminProfile. Atomic AuditLog customer.internal_note. Not implied by customers.suspend.',
  })
  createNote(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminCustomerNoteCreateDto,
  ) {
    return this.notes.createNote(admin, id, body);
  }

  @Post(':id/suspend')
  @RequirePermissions(ADMIN_PERMISSIONS.CUSTOMERS_SUSPEND)
  @ApiOperation({
    summary: 'Suspend customer Account',
    description:
      'Sets Account.status=SUSPENDED (Account-wide). Refuses AdminProfile co-location. Does not cancel orders. Optional auditNote for AuditLog only.',
  })
  suspend(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminCustomerLifecycleDto,
  ) {
    return this.commands.suspend(admin, id, body?.auditNote);
  }

  @Post(':id/reactivate')
  @RequirePermissions(ADMIN_PERMISSIONS.CUSTOMERS_SUSPEND)
  @ApiOperation({
    summary: 'Reactivate customer Account',
    description:
      'Sets Account.status=ACTIVE from SUSPENDED. Same protections as suspend.',
  })
  reactivate(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminCustomerLifecycleDto,
  ) {
    return this.commands.reactivate(admin, id, body?.auditNote);
  }
}
