import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PreviewCheckoutDto } from './checkout-write.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

async function parse(value: unknown): Promise<unknown> {
  return pipe.transform(value, {
    type: 'body',
    metatype: PreviewCheckoutDto,
  }) as Promise<unknown>;
}

const ADDRESS_ID = '11111111-1111-7111-8111-111111111111';

describe('Checkout write DTO validation', () => {
  it('accepts addressId only', async () => {
    await expect(parse({ addressId: ADDRESS_ID })).resolves.toEqual({
      addressId: ADDRESS_ID,
    });
  });

  it('rejects mass-assigned pricing, cart, zone, and coordinate fields', async () => {
    await expect(
      parse({ addressId: ADDRESS_ID, deliveryFee: 500 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, deliveryFeeMinor: 500 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, pricingRuleId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, cartId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, deliveryZoneId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, latitude: 36.75, longitude: 3.05 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, addressText: 'injected' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, checkoutReady: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, paymentMethod: 'COD' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, taxMinor: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, tax: 19 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, tipMinor: 200 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, tip: 50 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, tipPercentage: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, discountMinor: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ addressId: ADDRESS_ID, funding: 'MERCHANT' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts optional promoCode', async () => {
    await expect(
      parse({ addressId: ADDRESS_ID, promoCode: 'SAVE10' }),
    ).resolves.toEqual({
      addressId: ADDRESS_ID,
      promoCode: 'SAVE10',
    });
  });

  it('rejects invalid UUIDs', async () => {
    await expect(parse({ addressId: 'not-a-uuid' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
