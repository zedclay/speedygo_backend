import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ADMIN_PERMISSIONS } from '../../../admin/domain/admin-permissions';
import type { CurrentAdminContext } from '../../../admin/domain/admin.types';
import { CurrentAdmin } from '../../../admin/presentation/decorators/current-admin.decorator';
import { AdminGuard } from '../../../admin/presentation/guards/admin.guard';
import { AdminStorefrontCoverCommandsService } from '../../../admin/application/admin-storefront-cover-commands.service';
import { RequirePermissions } from '../../../authorization/require-permissions.decorator';
import { COVER_MAX_BYTES } from '../../../../infrastructure/storage/domain/cover-media.policy';
import { storageMalformedMultipart } from '../../../../infrastructure/storage/domain/storage.errors';
import { AdminCommerceVerticalCommandsService } from '../../application/admin-commerce-vertical-commands.service';
import {
  AssignCommerceVerticalDto,
  BindStorefrontCoverDto,
} from './dto/admin-commerce-vertical.dto';

@ApiTags('admin-merchant-branch-storefront')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/merchant-branches')
export class AdminMerchantBranchStorefrontController {
  constructor(
    private readonly verticals: AdminCommerceVerticalCommandsService,
    private readonly covers: AdminStorefrontCoverCommandsService,
  ) {}

  @Get(':branchId/classification')
  @RequirePermissions(ADMIN_PERMISSIONS.COMMERCE_VERTICALS_READ)
  @ApiOperation({ summary: 'Read explicit branch commerce classification' })
  getClassification(@Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.verticals.getClassification(branchId);
  }

  @Put(':branchId/classification')
  @RequirePermissions(ADMIN_PERMISSIONS.COMMERCE_VERTICALS_MANAGE)
  @ApiOperation({
    summary: 'Assign a branch to an active commerce category',
    description: 'Explicit only. Never inferred from names.',
  })
  assign(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() body: AssignCommerceVerticalDto,
  ) {
    return this.verticals.assignBranch(admin, branchId, body.verticalId);
  }

  @Delete(':branchId/classification')
  @RequirePermissions(ADMIN_PERMISSIONS.COMMERCE_VERTICALS_MANAGE)
  @ApiOperation({ summary: 'Remove a branch commerce classification' })
  unassign(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.verticals.unassignBranch(admin, branchId);
  }

  @Post(':branchId/cover/content')
  @RequirePermissions(ADMIN_PERMISSIONS.STOREFRONT_COVERS_MANAGE)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'JPEG or PNG. 400–4096 px. Max 2 MiB.',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload pending storefront cover bytes',
    description:
      'Purpose MERCHANT_BRANCH_COVER. Pending token is bound to this Admin account and the branch Merchant. Never a verification document.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: COVER_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  uploadCover(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw storageMalformedMultipart('Expected multipart field "file"');
    }
    return this.covers.uploadContent(admin, branchId, {
      body: file.buffer,
      declaredMime: file.mimetype,
      originalFilename: file.originalname,
    });
  }

  @Put(':branchId/cover')
  @RequirePermissions(ADMIN_PERMISSIONS.STOREFRONT_COVERS_MANAGE)
  @ApiOperation({ summary: 'Bind or replace the branch storefront cover' })
  bindCover(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() body: BindStorefrontCoverDto,
  ) {
    return this.covers.bind(admin, branchId, body.uploadReference);
  }

  @Delete(':branchId/cover')
  @RequirePermissions(ADMIN_PERMISSIONS.STOREFRONT_COVERS_MANAGE)
  @ApiOperation({ summary: 'Delete the branch storefront cover' })
  removeCover(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.covers.remove(admin, branchId);
  }
}
