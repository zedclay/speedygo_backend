import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateOrderDto, ListOrdersQueryDto } from './order-write.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

async function parse(
  value: unknown,
  metatype: typeof CreateOrderDto | typeof ListOrdersQueryDto = CreateOrderDto,
): Promise<unknown> {
  return pipe.transform(value, {
    type: metatype === CreateOrderDto ? 'body' : 'query',
    metatype,
  }) as Promise<unknown>;
}

const ADDRESS_ID = '11111111-1111-7111-8111-111111111111';

const VALID = {
  addressId: ADDRESS_ID,
  paymentMethod: 'COD',
  expectedMerchandiseSubtotalMinor: 1200,
  expectedDeliveryFeeMinor: 500,
  expectedCustomerTotalMinor: 1700,
};

describe('Order write DTO validation', () => {
  it('accepts addressId, paymentMethod, and expected confirmation amounts', async () => {
    await expect(parse(VALID)).resolves.toEqual(VALID);
  });

  it('rejects mass-assigned cart, pricing, status, and identity fields', async () => {
    await expect(
      parse({ ...VALID, cartId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, customerId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, accountId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, merchantId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, merchantBranchId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, zoneId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, deliveryZoneId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, pricingRuleId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, commissionRuleId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, productId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, deliveryFeeMinor: 500 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, customerTotalMinor: 1700 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, expectedCustomerPayableMinor: 1700 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, status: 'CONFIRMED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, fulfillmentStatus: 'ACCEPTED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(parse({ ...VALID, priceMinor: 1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(parse({ ...VALID, commission: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      parse({ ...VALID, driverRemunerationMinor: 300 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, merchantDiscountMinor: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(parse({ ...VALID, tax: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(parse({ ...VALID, tip: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(parse({ ...VALID, promoCode: 'X' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      parse({ ...VALID, promotionId: ADDRESS_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(parse({ ...VALID, serviceFee: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects negative, fractional, and unsafe expected amounts', async () => {
    await expect(
      parse({ ...VALID, expectedMerchandiseSubtotalMinor: -1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ ...VALID, expectedDeliveryFeeMinor: 1.5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({
        ...VALID,
        expectedCustomerTotalMinor: Number.MAX_SAFE_INTEGER,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid address UUIDs', async () => {
    await expect(
      parse({ ...VALID, addressId: 'not-a-uuid' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
