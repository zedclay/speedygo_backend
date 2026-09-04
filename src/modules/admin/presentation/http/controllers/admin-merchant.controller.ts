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
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { MerchantVerificationService } from '../../../../merchants/application/merchant-verification.service';
import { AdminMerchantCommandsService } from '../../../application/admin-merchant-commands.service';
import { ADMIN_PERMISSIONS } from '../../../domain/admin-permissions';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { AdminQueryRepository } from '../../../infrastructure/admin-query.repository';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import { AdminGuard } from '../../guards/admin.guard';
import {
  AdminEmptyBodyDto,
  AdminListQueryDto,
  AdminStatusListQueryDto,
} from '../dto/admin.dto';

@ApiTags('admin-merchants')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/merchants')
export class AdminMerchantController {
  constructor(
    private readonly queries: AdminQueryRepository,
    private readonly commands: AdminMerchantCommandsService,
    private readonly verificationService: MerchantVerificationService,
  ) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.MERCHANTS_READ)
  @ApiOperation({ summary: 'List merchants (paginated)' })
  @ApiOkResponse({ description: 'Merchant list' })
  list(@Query() query: AdminStatusListQueryDto) {
    return this.queries.listMerchants(query);
  }

  @Get('verification/queue')
  @RequirePermissions(ADMIN_PERMISSIONS.MERCHANTS_VERIFY)
  @ApiOperation({
    summary: 'Merchant verification queue',
    description:
      'Only formally submitted PENDING_REVIEW packages (verificationSubmitted). Incomplete PENDING_REVIEW Merchants are excluded. Paginated via SQL discovery of merchants with both required documents SUBMITTED.',
  })
  queue(@Query() query: AdminListQueryDto) {
    return this.queries.listMerchantVerificationQueue(query);
  }

  @Get(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.MERCHANTS_READ)
  @ApiOperation({ summary: 'Merchant detail' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.getMerchant(id);
  }

  @Get(':id/verification')
  @RequirePermissions(ADMIN_PERMISSIONS.MERCHANTS_VERIFY)
  @ApiOperation({
    summary: 'Internal merchant verification package',
    description:
      'Uses MerchantVerificationService.getInternalVerificationPackage. No storage keys.',
  })
  async getVerification(@Param('id', ParseUUIDPipe) id: string) {
    const pkg =
      await this.verificationService.getInternalVerificationPackage(id);
    return {
      merchantId: pkg.merchantId,
      status: pkg.status,
      verifiedAt: pkg.verifiedAt,
      verificationReady: pkg.verificationReady,
      verificationSubmitted: pkg.verificationSubmitted,
      verificationAttentionRequired: pkg.verificationAttentionRequired,
      evidenceEditable: pkg.evidenceEditable,
      evidenceChecklist: pkg.evidenceChecklist,
      documents: pkg.documents.map((doc) => ({
        id: doc.id,
        type: doc.type,
        status: doc.status,
        expiryDate: doc.expiryDate,
      })),
    };
  }

  @Post(':id/verification/approve')
  @RequirePermissions(ADMIN_PERMISSIONS.MERCHANTS_VERIFY)
  @ApiOperation({
    summary: 'Approve merchant verification',
    description:
      'Calls MerchantReviewService.approve with CurrentAdmin.adminProfileId. Body adminId is ignored/rejected.',
  })
  approve(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    return this.commands.approveVerification(admin, id);
  }

  @Post(':id/verification/reject')
  @RequirePermissions(ADMIN_PERMISSIONS.MERCHANTS_VERIFY)
  @ApiOperation({
    summary: 'Reject merchant verification',
    description: 'No rejection reason field is accepted or persisted in v1.0.',
  })
  reject(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    return this.commands.rejectVerification(admin, id);
  }

  @Post(':id/suspend')
  @RequirePermissions(ADMIN_PERMISSIONS.MERCHANTS_SUSPEND)
  @ApiOperation({ summary: 'Suspend an ACTIVE verified merchant' })
  suspend(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    return this.commands.suspend(admin, id);
  }
}
