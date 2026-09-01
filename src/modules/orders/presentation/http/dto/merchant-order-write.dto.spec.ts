import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  ListMerchantOrdersQueryDto,
  MerchantOrderActionDto,
  RejectMerchantOrderDto,
} from './merchant-order-write.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

async function parse(
  value: unknown,
  metatype:
    | typeof ListMerchantOrdersQueryDto
    | typeof MerchantOrderActionDto
    | typeof RejectMerchantOrderDto,
): Promise<unknown> {
  return pipe.transform(value, {
    type: metatype === ListMerchantOrdersQueryDto ? 'query' : 'body',
    metatype,
  }) as Promise<unknown>;
}

describe('Merchant Order write DTO validation', () => {
  it('accepts owned-branch and frozen status filters', async () => {
    await expect(
      parse(
        {
          branchId: '11111111-1111-7111-8111-111111111111',
          orderStatus: 'CREATED',
          fulfillmentStatus: 'PENDING_ACCEPTANCE',
          limit: 10,
        },
        ListMerchantOrdersQueryDto,
      ),
    ).resolves.toEqual({
      branchId: '11111111-1111-7111-8111-111111111111',
      orderStatus: 'CREATED',
      fulfillmentStatus: 'PENDING_ACCEPTANCE',
      limit: 10,
    });
  });

  it('rejects unknown status filters and injected driver fields', async () => {
    await expect(
      parse({ orderStatus: 'DELIVERED' }, ListMerchantOrdersQueryDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(
        { driverId: '11111111-1111-7111-8111-111111111111' },
        ListMerchantOrdersQueryDto,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects mass-assigned status on explicit actions', async () => {
    await expect(parse({}, MerchantOrderActionDto)).resolves.toEqual({});
    await expect(
      parse({ status: 'CONFIRMED' }, MerchantOrderActionDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ fulfillmentStatus: 'READY' }, MerchantOrderActionDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a bounded rejection reason', async () => {
    await expect(
      parse({ reason: 'Out of stock' }, RejectMerchantOrderDto),
    ).resolves.toEqual({ reason: 'Out of stock' });
    await expect(
      parse({ reason: '  Out of stock  ' }, RejectMerchantOrderDto),
    ).resolves.toEqual({ reason: 'Out of stock' });
    await expect(parse({}, RejectMerchantOrderDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      parse({ reason: '' }, RejectMerchantOrderDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(
        { reason: 'Too busy', status: 'CANCELLED' },
        RejectMerchantOrderDto,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
