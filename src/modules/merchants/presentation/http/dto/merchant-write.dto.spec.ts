import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  CreateMerchantProfileDto,
  UpdateMerchantBranchDto,
  UpdateMerchantProfileDto,
} from './merchant-write.dto';

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

describe('Merchant write DTO validation', () => {
  it('rejects server-managed merchant fields', async () => {
    await expect(
      parse(CreateMerchantProfileDto, {
        name: 'Cafe',
        status: 'ACTIVE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(UpdateMerchantProfileDto, {
        name: 'Cafe',
        verifiedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(UpdateMerchantProfileDto, {
        publicReference: 'sgm_x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(CreateMerchantProfileDto, {
        name: 'Cafe',
        accountId: '11111111-1111-7111-8111-111111111111',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(UpdateMerchantProfileDto, {
        name: 'Cafe',
        role: 'OWNER',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(CreateMerchantProfileDto, {
        name: 'Cafe',
        commissionBps: 1000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects operationalStatus, role, and merchantId on branch payloads', async () => {
    await expect(
      parse(UpdateMerchantBranchDto, {
        name: 'Branch',
        operationalStatus: 'CLOSED',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(UpdateMerchantBranchDto, {
        merchantId: '11111111-1111-7111-8111-111111111111',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(UpdateMerchantBranchDto, {
        role: 'OWNER',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
