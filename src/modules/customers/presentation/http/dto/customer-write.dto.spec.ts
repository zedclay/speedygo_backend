import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CUSTOMER_ADDRESS_TEXT_MAX_LENGTH } from '../../../domain/customer.types';
import {
  CreateCustomerAddressDto,
  CreateCustomerProfileDto,
  UpdateCustomerProfileDto,
} from './customer-write.dto';

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

describe('Customer write DTO validation', () => {
  it('rejects avatarUrl on profile create and update', async () => {
    await expect(
      parse(CreateCustomerProfileDto, {
        fullName: 'Ada',
        avatarUrl: 'https://cdn.example/ada.png',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(UpdateCustomerProfileDto, {
        fullName: 'Ada',
        avatarUrl: 'https://cdn.example/ada.png',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects phone and email on CustomerProfile payloads', async () => {
    await expect(
      parse(CreateCustomerProfileDto, {
        fullName: 'Ada',
        phone: '+213550000000',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse(UpdateCustomerProfileDto, {
        email: 'ada@example.com',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects addressText longer than 500 characters', async () => {
    await expect(
      parse(CreateCustomerAddressDto, {
        label: 'Home',
        addressText: 'x'.repeat(CUSTOMER_ADDRESS_TEXT_MAX_LENGTH + 1),
        latitude: 36.75,
        longitude: 3.05,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts isDefault on create without treating it as a profile field', async () => {
    const body = (await parse(CreateCustomerAddressDto, {
      label: 'Home',
      addressText: 'Street 1',
      latitude: 36.75,
      longitude: 3.05,
      isDefault: false,
    })) as CreateCustomerAddressDto;
    expect(body.isDefault).toBe(false);
    expect(body.addressText).toBe('Street 1');
  });
});
