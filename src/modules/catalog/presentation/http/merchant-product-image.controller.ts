import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
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
import type { Response } from 'express';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { PRODUCT_IMAGE_MAX_BYTES } from '../../../../infrastructure/storage/domain/product-image.policy';
import { storageMalformedMultipart } from '../../../../infrastructure/storage/domain/storage.errors';
import { MerchantProductImageService } from '../../application/merchant-product-image.service';
import { BindProductImageDto } from './dto/catalog-write.dto';

@ApiTags('catalog-product-images')
@ApiBearerAuth()
@Controller('merchant/:merchantId/branches/:branchId/products/:productId')
export class MerchantProductImageController {
  constructor(private readonly images: MerchantProductImageService) {}

  @Get('image')
  @ApiOperation({
    summary: 'Stream the bound product image',
    description:
      'CATALOG_READ (and stronger roles). Streams the bound product-images/ object for an owned Branch Product. Missing image → STORAGE_OBJECT_MISSING. Never a verification document or storefront cover.',
  })
  async getImage(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.images.readForMerchant(
      principal.accountId,
      merchantId,
      branchId,
      productId,
    );
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(file.body);
  }

  @Post('image/content')
  @HttpCode(200)
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
      'OWNER and MANAGER (PRODUCT_MANAGE). Multipart field `file`. Purpose PRODUCT_IMAGE only. Pending token is bound to this Account, Merchant, Branch, and Product. Never a verification document or storefront cover.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PRODUCT_IMAGE_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  uploadContent(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw storageMalformedMultipart('Expected multipart field "file"');
    }
    return this.images.uploadContent(
      principal.accountId,
      merchantId,
      branchId,
      productId,
      {
        body: file.buffer,
        declaredMime: file.mimetype,
        originalFilename: file.originalname,
      },
    );
  }

  @Put('image')
  @ApiOperation({
    summary: 'Bind or replace the product image',
    description:
      'OWNER and MANAGER. uploadReference must be a PRODUCT_IMAGE pending token owned by this Account, Merchant, Branch, and Product. Rechecks authorization. Replaces the previous product-images/ object.',
  })
  bind(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() body: BindProductImageDto,
  ) {
    return this.images.bind(
      principal.accountId,
      merchantId,
      branchId,
      productId,
      body.uploadReference,
    );
  }

  @Delete('image')
  @ApiOperation({
    summary: 'Delete the product image',
    description:
      'OWNER and MANAGER. Removes metadata and the product-images/ object when unreferenced.',
  })
  remove(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ) {
    return this.images.remove(
      principal.accountId,
      merchantId,
      branchId,
      productId,
    );
  }
}
