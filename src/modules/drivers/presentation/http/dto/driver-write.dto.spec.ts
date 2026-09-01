import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  CreateDriverProfileDto,
  CreateDriverVehicleDto,
  UpdateDriverProfileDto,
  UpsertDriverDocumentDto,
} from './driver-write.dto';

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

describe('Driver write DTO validation', () => {
  it('rejects verification and availability injection on profile create', async () => {
    await expect(
      parse(CreateDriverProfileDto, {
        fullName: 'Ada',
        verificationStatus: 'APPROVED',
        approvedAt: '2026-01-01T00:00:00.000Z',
        availability: 'ONLINE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects status and fileUrl on documents', async () => {
    await expect(
      parse(UpsertDriverDocumentDto, {
        expiryDate: '2099-01-01',
        fileUrl: 'https://evil.example/doc.png',
        status: 'VERIFIED',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects filesystem paths and base64 document payloads', async () => {
    await expect(
      parse(UpsertDriverDocumentDto, {
        expiryDate: '2099-01-01',
        fileUrl: '/tmp/license.png',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(UpsertDriverDocumentDto, {
        expiryDate: '2099-01-01',
        file: 'data:image/png;base64,AAAA',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects vehicle status injection', async () => {
    await expect(
      parse(CreateDriverVehicleDto, {
        type: 'MOTORCYCLE',
        plateNumber: '12345-123-01',
        model: 'NMAX',
        status: 'ACTIVE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects accountId on profile update', async () => {
    await expect(
      parse(UpdateDriverProfileDto, {
        fullName: 'Ada',
        accountId: '11111111-1111-7111-8111-111111111111',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
