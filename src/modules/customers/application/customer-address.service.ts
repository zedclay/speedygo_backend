import { Injectable } from '@nestjs/common';
import {
  customerAddressInvalid,
  customerAddressNotFound,
  customerProfileNotFound,
} from '../domain/customer.errors';
import {
  hasValidCoordinates,
  toAddressView,
  type CreateAddressInput,
  type CustomerAddressView,
  type UpdateAddressInput,
} from '../domain/customer.types';
import { CustomerRepository } from '../infrastructure/customer.repository';

@Injectable()
export class CustomerAddressService {
  constructor(private readonly customers: CustomerRepository) {}

  async list(accountId: string): Promise<{ addresses: CustomerAddressView[] }> {
    const profile = await this.requireProfile(accountId);
    const addresses = await this.customers.listAddresses(profile.id);
    return { addresses: addresses.map(toAddressView) };
  }

  async create(
    accountId: string,
    input: CreateAddressInput,
  ): Promise<CustomerAddressView> {
    const profile = await this.requireProfile(accountId);
    this.assertCoordinates(input.latitude, input.longitude);
    const created = await this.customers.createAddress(profile.id, input);
    return toAddressView(created);
  }

  async update(
    accountId: string,
    addressId: string,
    input: UpdateAddressInput,
  ): Promise<CustomerAddressView> {
    const profile = await this.requireProfile(accountId);
    const existing = await this.customers.findOwnedAddress(
      profile.id,
      addressId,
    );
    if (!existing) {
      throw customerAddressNotFound();
    }
    const latitude = input.latitude ?? existing.latitude;
    const longitude = input.longitude ?? existing.longitude;
    this.assertCoordinates(latitude, longitude);
    const updated = await this.customers.updateAddress(
      profile.id,
      addressId,
      input,
    );
    if (!updated) {
      throw customerAddressNotFound();
    }
    return toAddressView(updated);
  }

  async remove(
    accountId: string,
    addressId: string,
  ): Promise<{ deleted: true }> {
    const profile = await this.requireProfile(accountId);
    const deleted = await this.customers.deleteAddress(profile.id, addressId);
    if (!deleted) {
      throw customerAddressNotFound();
    }
    return { deleted: true };
  }

  async setDefault(
    accountId: string,
    addressId: string,
  ): Promise<CustomerAddressView> {
    const profile = await this.requireProfile(accountId);
    const updated = await this.customers.setDefaultAddress(
      profile.id,
      addressId,
    );
    if (!updated) {
      throw customerAddressNotFound();
    }
    return toAddressView(updated);
  }

  private async requireProfile(accountId: string) {
    const profile = await this.customers.findProfileByAccountId(accountId);
    if (!profile) {
      throw customerProfileNotFound();
    }
    return profile;
  }

  private assertCoordinates(latitude: number, longitude: number): void {
    if (!hasValidCoordinates(latitude, longitude)) {
      throw customerAddressInvalid('Coordinates are outside the allowed range');
    }
  }
}
