import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  CreateCatalogCategoryDto,
  CreateCatalogOptionDto,
  CreateCatalogOptionGroupDto,
  CreateCatalogProductDto,
  UpdateCatalogProductDto,
} from './catalog-write.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

async function parse(
  metatype: new () => object,
  value: unknown,
): Promise<unknown> {
  return pipe.transform(value, { type: 'body', metatype }) as Promise<unknown>;
}

describe('Catalog write DTO validation', () => {
  it('rejects server-managed and internal fields', async () => {
    await expect(
      parse(CreateCatalogCategoryDto, {
        branchId: '11111111-1111-7111-8111-111111111111',
        name: 'Drinks',
        merchantId: '11111111-1111-7111-8111-111111111111',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(CreateCatalogProductDto, {
        branchId: '11111111-1111-7111-8111-111111111111',
        categoryId: '11111111-1111-7111-8111-111111111111',
        name: 'Coffee',
        priceMinor: 1099,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(UpdateCatalogProductDto, {
        name: 'Coffee',
        imageUrl: 'https://evil.example/x.png',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(CreateCatalogProductDto, {
        branchId: '11111111-1111-7111-8111-111111111111',
        categoryId: '11111111-1111-7111-8111-111111111111',
        name: 'Coffee',
        priceMinor: 1099,
        status: 'DRAFT',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(UpdateCatalogProductDto, {
        status: 'PUBLISHED',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(UpdateCatalogProductDto, {
        status: 'ARCHIVED',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects float prices and negative option deltas', async () => {
    await expect(
      parse(CreateCatalogProductDto, {
        branchId: '11111111-1111-7111-8111-111111111111',
        categoryId: '11111111-1111-7111-8111-111111111111',
        name: 'Coffee',
        priceMinor: 10.99,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(CreateCatalogOptionDto, {
        name: 'Large',
        additionalPriceMinor: -1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(CreateCatalogOptionGroupDto, {
        name: 'Size',
        required: true,
        minSelections: 1,
        maxSelections: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
