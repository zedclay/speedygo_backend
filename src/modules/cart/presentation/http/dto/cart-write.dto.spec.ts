import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AddCartItemDto, UpdateCartItemDto } from './cart-write.dto';

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

describe('Cart write DTO validation', () => {
  it('rejects mass-assigned financial and ownership fields', async () => {
    await expect(
      parse(AddCartItemDto, {
        productId: '11111111-1111-7111-8111-111111111111',
        quantity: 1,
        priceMinor: 1099,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(AddCartItemDto, {
        productId: '11111111-1111-7111-8111-111111111111',
        quantity: 1,
        customerId: '11111111-1111-7111-8111-111111111111',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(AddCartItemDto, {
        productId: '11111111-1111-7111-8111-111111111111',
        quantity: 1,
        merchantBranchId: '11111111-1111-7111-8111-111111111111',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(AddCartItemDto, {
        productId: '11111111-1111-7111-8111-111111111111',
        quantity: 1,
        subtotal: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(UpdateCartItemDto, {
        quantity: 2,
        additionalPriceMinor: 50,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(UpdateCartItemDto, {
        quantity: 2,
        unitPriceMinor: 1200,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid quantity', async () => {
    await expect(
      parse(AddCartItemDto, {
        productId: '11111111-1111-7111-8111-111111111111',
        quantity: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(AddCartItemDto, {
        productId: '11111111-1111-7111-8111-111111111111',
        quantity: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
