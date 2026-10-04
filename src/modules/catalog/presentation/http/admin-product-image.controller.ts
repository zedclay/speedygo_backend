import {
  Body,
  Controller,
  Delete,
  HttpCode,
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
import { AdminProductImageCommandsService } from '../../../admin/application/admin-product-image-commands.service';
import { RequirePermissions } from '../../../authorization/require-permissions.decorator';
import { PRODUCT_IMAGE_MAX_BYTES } from '../../../../infrastructure/storage/domain/product-image.policy';
import { storageMalformedMultipart } from '../../../../infrastructure/storage/domain/storage.errors';
import { BindProductImageDto } from './dto/catalog-write.dto';

@ApiTags('admin-product-images')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/products')
export class AdminProductImageController {
  constructor(private readonly images: AdminProductImageCommandsService) {}

  @Post(':productId/image/content')
  @HttpCode(200)
  @RequirePermissions(ADMIN_PERMISSIONS.PRODUCT_IMAGES_MANAGE)
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
    summary: 'Upload pending product image bytes',
    description:
      'Purpose PRODUCT_IMAGE. Pending token is bound to this Admin account and the product Merchant/Branch/Product. Never a verification document or storefront cover.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PRODUCT_IMAGE_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  uploadContent(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw storageMalformedMultipart('Expected multipart field "file"');
    }
    return this.images.uploadContent(admin, productId, {
      body: file.buffer,
      declaredMime: file.mimetype,
      originalFilename: file.originalname,
    });
  }

  @Put(':productId/image')
  @RequirePermissions(ADMIN_PERMISSIONS.PRODUCT_IMAGES_MANAGE)
  @ApiOperation({ summary: 'Bind or replace the product image' })
  bind(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: BindProductImageDto,
  ) {
    return this.images.bind(admin, productId, body.uploadReference);
  }

  @Delete(':productId/image')
  @RequirePermissions(ADMIN_PERMISSIONS.PRODUCT_IMAGES_MANAGE)
  @ApiOperation({ summary: 'Delete the product image' })
  remove(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.images.remove(admin, productId);
  }
}
