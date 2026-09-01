import { Injectable } from '@nestjs/common';
import {
  customerProfileAlreadyExists,
  customerProfileNotFound,
} from '../domain/customer.errors';
import {
  isAddressReady,
  isProfileComplete,
  toAddressView,
  toProfileView,
  type CreateProfileInput,
  type CustomerMeView,
  type CustomerProfileView,
  type UpdateProfileInput,
} from '../domain/customer.types';
import { CustomerRepository } from '../infrastructure/customer.repository';

@Injectable()
export class CustomerProfileService {
  constructor(private readonly customers: CustomerRepository) {}

  async getMe(accountId: string): Promise<CustomerMeView> {
    const profile = await this.customers.findProfileByAccountId(accountId);
    if (!profile) {
      return {
        customerProfileExists: false,
        profileComplete: false,
        addressReady: false,
        profile: null,
        addresses: [],
        defaultAddressId: null,
      };
    }
    const addresses = await this.customers.listAddresses(profile.id);
    const defaultAddress = addresses.find((address) => address.isDefault);
    return {
      customerProfileExists: true,
      profileComplete: isProfileComplete(profile.fullName),
      addressReady: isAddressReady(addresses),
      profile: toProfileView(profile),
      addresses: addresses.map(toAddressView),
      defaultAddressId: defaultAddress?.id ?? null,
    };
  }

  async create(
    accountId: string,
    input: CreateProfileInput,
  ): Promise<CustomerProfileView> {
    const existing = await this.customers.findProfileByAccountId(accountId);
    if (existing) {
      throw customerProfileAlreadyExists();
    }
    const created = await this.customers.createProfile(accountId, input);
    return toProfileView(created);
  }

  async update(
    accountId: string,
    input: UpdateProfileInput,
  ): Promise<CustomerProfileView> {
    const existing = await this.customers.findProfileByAccountId(accountId);
    if (!existing) {
      throw customerProfileNotFound();
    }
    const updated = await this.customers.updateProfile(existing.id, input);
    if (!updated) {
      throw customerProfileNotFound();
    }
    return toProfileView(updated);
  }
}
