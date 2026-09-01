import {
  customerProfileAlreadyExists,
  CUSTOMER_ERROR_CODES,
} from '../domain/customer.errors';
import {
  isAddressReady,
  isProfileComplete,
  type AddressRecord,
  type CreateAddressInput,
  type CreateProfileInput,
  type CustomerProfileRecord,
  type UpdateAddressInput,
  type UpdateProfileInput,
} from '../domain/customer.types';
import { CustomerAddressService } from './customer-address.service';
import { CustomerProfileService } from './customer-profile.service';

const ACCOUNT_A = '11111111-1111-7111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-7222-8222-222222222222';

function now(): string {
  return new Date().toISOString();
}

class MemoryCustomerRepository {
  profiles = new Map<string, CustomerProfileRecord>();
  addresses = new Map<string, AddressRecord[]>();
  uniqueCreateShouldFail = false;

  findProfileByAccountId(
    accountId: string,
  ): Promise<CustomerProfileRecord | null> {
    return Promise.resolve(this.profiles.get(accountId) ?? null);
  }

  createProfile(
    accountId: string,
    input: CreateProfileInput,
  ): Promise<CustomerProfileRecord> {
    if (this.uniqueCreateShouldFail || this.profiles.has(accountId)) {
      return Promise.reject(customerProfileAlreadyExists());
    }
    const row: CustomerProfileRecord = {
      id: `profile-${accountId}`,
      accountId,
      fullName: input.fullName,
      avatarUrl: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.profiles.set(accountId, row);
    this.addresses.set(row.id, []);
    return Promise.resolve(row);
  }

  updateProfile(
    profileId: string,
    input: UpdateProfileInput,
  ): Promise<CustomerProfileRecord | null> {
    for (const [accountId, profile] of this.profiles) {
      if (profile.id !== profileId) {
        continue;
      }
      const next: CustomerProfileRecord = {
        ...profile,
        fullName: input.fullName ?? profile.fullName,
        updatedAt: now(),
      };
      this.profiles.set(accountId, next);
      return Promise.resolve(next);
    }
    return Promise.resolve(null);
  }

  listAddresses(customerId: string): Promise<AddressRecord[]> {
    return Promise.resolve(
      [...(this.addresses.get(customerId) ?? [])].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
    );
  }

  findOwnedAddress(
    customerId: string,
    addressId: string,
  ): Promise<AddressRecord | null> {
    return Promise.resolve(
      this.addresses.get(customerId)?.find((row) => row.id === addressId) ??
        null,
    );
  }

  createAddress(
    customerId: string,
    input: CreateAddressInput,
  ): Promise<AddressRecord> {
    const list = this.addresses.get(customerId) ?? [];
    const isFirst = list.length === 0;
    const row: AddressRecord = {
      id: `addr-${list.length + 1}-${customerId.slice(0, 8)}`,
      customerId,
      label: input.label,
      addressText: input.addressText,
      latitude: input.latitude,
      longitude: input.longitude,
      isDefault: isFirst,
      createdAt: now(),
      updatedAt: now(),
    };
    list.push(row);
    this.addresses.set(customerId, list);
    this.assertSingleDefault(list);
    return Promise.resolve(row);
  }

  updateAddress(
    customerId: string,
    addressId: string,
    input: UpdateAddressInput,
  ): Promise<AddressRecord | null> {
    const list = this.addresses.get(customerId) ?? [];
    const row = list.find((item) => item.id === addressId);
    if (!row) {
      return Promise.resolve(null);
    }
    if (input.label !== undefined) {
      row.label = input.label;
    }
    if (input.addressText !== undefined) {
      row.addressText = input.addressText;
    }
    if (input.latitude !== undefined) {
      row.latitude = input.latitude;
    }
    if (input.longitude !== undefined) {
      row.longitude = input.longitude;
    }
    row.updatedAt = now();
    return Promise.resolve(row);
  }

  deleteAddress(customerId: string, addressId: string): Promise<boolean> {
    const list = this.addresses.get(customerId) ?? [];
    const next = list.filter((item) => item.id !== addressId);
    if (next.length === list.length) {
      return Promise.resolve(false);
    }
    this.addresses.set(customerId, next);
    return Promise.resolve(true);
  }

  setDefaultAddress(
    customerId: string,
    addressId: string,
  ): Promise<AddressRecord | null> {
    const list = this.addresses.get(customerId) ?? [];
    const target = list.find((item) => item.id === addressId);
    if (!target) {
      return Promise.resolve(null);
    }
    for (const address of list) {
      address.isDefault = address.id === addressId;
      address.updatedAt = now();
    }
    this.assertSingleDefault(list);
    return Promise.resolve(target);
  }

  private assertSingleDefault(list: AddressRecord[]): void {
    const defaults = list.filter((item) => item.isDefault);
    if (defaults.length > 1) {
      throw new Error('more than one default address');
    }
  }
}

describe('CustomerProfileService', () => {
  let repo: MemoryCustomerRepository;
  let service: CustomerProfileService;

  beforeEach(() => {
    repo = new MemoryCustomerRepository();
    service = new CustomerProfileService(repo as never);
  });

  it('returns bootstrap state when the profile is absent', async () => {
    const me = await service.getMe(ACCOUNT_A);
    expect(me).toEqual({
      customerProfileExists: false,
      profileComplete: false,
      addressReady: false,
      profile: null,
      addresses: [],
      defaultAddressId: null,
    });
  });

  it('creates a profile and does not expose accountId', async () => {
    const created = await service.create(ACCOUNT_A, { fullName: 'Ada' });
    expect(created.fullName).toBe('Ada');
    expect(created).not.toHaveProperty('accountId');
    const me = await service.getMe(ACCOUNT_A);
    expect(me.customerProfileExists).toBe(true);
    expect(me.profileComplete).toBe(true);
    expect(me.profile?.fullName).toBe('Ada');
  });

  it('rejects a duplicate profile', async () => {
    await service.create(ACCOUNT_A, { fullName: 'Ada' });
    await expect(
      service.create(ACCOUNT_A, { fullName: 'Other' }),
    ).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_ALREADY_EXISTS,
    });
    await expect(
      service.create(ACCOUNT_A, { fullName: 'Race' }),
    ).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_ALREADY_EXISTS,
    });
  });

  it('maps a unique-constraint race to CUSTOMER_PROFILE_ALREADY_EXISTS', async () => {
    repo.uniqueCreateShouldFail = true;
    await expect(
      service.create(ACCOUNT_A, { fullName: 'Ada' }),
    ).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_ALREADY_EXISTS,
    });
    expect(repo.profiles.size).toBe(0);
  });

  it('updates only fullName and does not write avatarUrl', async () => {
    await service.create(ACCOUNT_A, { fullName: 'Ada' });
    const updated = await service.update(ACCOUNT_A, {
      fullName: 'Ada Lovelace',
    });
    expect(updated.fullName).toBe('Ada Lovelace');
    expect(updated.avatarUrl).toBeNull();
    expect(updated).not.toHaveProperty('accountId');
  });

  it('does not let account A update account B', async () => {
    await service.create(ACCOUNT_B, { fullName: 'Bob' });
    await expect(
      service.update(ACCOUNT_A, { fullName: 'Hijack' }),
    ).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
    });
    expect(repo.profiles.get(ACCOUNT_B)?.fullName).toBe('Bob');
  });

  it('derives profileComplete from non-empty fullName only', () => {
    expect(isProfileComplete('Ada')).toBe(true);
    expect(isProfileComplete('  ')).toBe(false);
    expect(isProfileComplete('')).toBe(false);
  });
});

describe('CustomerAddressService', () => {
  let repo: MemoryCustomerRepository;
  let profiles: CustomerProfileService;
  let addresses: CustomerAddressService;

  beforeEach(async () => {
    repo = new MemoryCustomerRepository();
    profiles = new CustomerProfileService(repo as never);
    addresses = new CustomerAddressService(repo as never);
    await profiles.create(ACCOUNT_A, { fullName: 'Ada' });
  });

  it('creates the first address as default even when the client requests otherwise', async () => {
    const created = await addresses.create(ACCOUNT_A, {
      label: 'Home',
      addressText: 'Street 1',
      latitude: 36.75,
      longitude: 3.05,
    });
    expect(created.isDefault).toBe(true);
    const me = await profiles.getMe(ACCOUNT_A);
    expect(me.profileComplete).toBe(true);
    expect(me.addressReady).toBe(true);
    expect(me.defaultAddressId).toBe(created.id);
  });

  it('does not let a second address replace the first default', async () => {
    const first = await addresses.create(ACCOUNT_A, {
      label: 'Home',
      addressText: 'Street 1',
      latitude: 36.75,
      longitude: 3.05,
    });
    const second = await addresses.create(ACCOUNT_A, {
      label: 'Work',
      addressText: 'Street 2',
      latitude: 36.76,
      longitude: 3.06,
    });
    expect(second.isDefault).toBe(false);
    const listed = await addresses.list(ACCOUNT_A);
    const defaults = listed.addresses.filter((item) => item.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(first.id);
  });

  it('updates an owned address', async () => {
    const created = await addresses.create(ACCOUNT_A, {
      label: 'Home',
      addressText: 'Street 1',
      latitude: 36.75,
      longitude: 3.05,
    });
    const updated = await addresses.update(ACCOUNT_A, created.id, {
      label: 'Work',
      addressText: 'Street 2',
    });
    expect(updated.label).toBe('Work');
    expect(updated.addressText).toBe('Street 2');
  });

  it('deletes the default address without auto-selecting another', async () => {
    const home = await addresses.create(ACCOUNT_A, {
      label: 'Home',
      addressText: 'Street 1',
      latitude: 36.75,
      longitude: 3.05,
    });
    await addresses.create(ACCOUNT_A, {
      label: 'Work',
      addressText: 'Street 2',
      latitude: 36.76,
      longitude: 3.06,
    });
    await addresses.remove(ACCOUNT_A, home.id);
    const listed = await addresses.list(ACCOUNT_A);
    expect(listed.addresses).toHaveLength(1);
    expect(listed.addresses[0]?.isDefault).toBe(false);
    const me = await profiles.getMe(ACCOUNT_A);
    expect(me.profileComplete).toBe(true);
    expect(me.addressReady).toBe(false);
    expect(me.defaultAddressId).toBeNull();
  });

  it('cannot read or mutate another customer address', async () => {
    await profiles.create(ACCOUNT_B, { fullName: 'Bob' });
    const bAddress = await addresses.create(ACCOUNT_B, {
      label: 'Secret',
      addressText: 'Hidden',
      latitude: 35.7,
      longitude: 4.1,
    });
    await expect(
      addresses.update(ACCOUNT_A, bAddress.id, { label: 'X' }),
    ).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_ADDRESS_NOT_FOUND,
    });
    await expect(
      addresses.remove(ACCOUNT_A, bAddress.id),
    ).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_ADDRESS_NOT_FOUND,
    });
    await expect(
      addresses.setDefault(ACCOUNT_A, bAddress.id),
    ).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_ADDRESS_NOT_FOUND,
    });
    const listed = await addresses.list(ACCOUNT_A);
    expect(listed.addresses).toHaveLength(0);
  });

  it('switches default so only one remains', async () => {
    const a = await addresses.create(ACCOUNT_A, {
      label: 'A',
      addressText: 'A',
      latitude: 36.75,
      longitude: 3.05,
    });
    const b = await addresses.create(ACCOUNT_A, {
      label: 'B',
      addressText: 'B',
      latitude: 36.76,
      longitude: 3.06,
    });
    expect(a.isDefault).toBe(true);
    expect(b.isDefault).toBe(false);
    await addresses.setDefault(ACCOUNT_A, a.id);
    await addresses.setDefault(ACCOUNT_A, b.id);
    const listed = await addresses.list(ACCOUNT_A);
    const defaults = listed.addresses.filter((item) => item.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(b.id);
    expect(isAddressReady(listed.addresses)).toBe(true);
  });

  it('rejects invalid coordinates', async () => {
    await expect(
      addresses.create(ACCOUNT_A, {
        label: 'Bad',
        addressText: 'Bad',
        latitude: 91,
        longitude: 3,
      }),
    ).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_ADDRESS_INVALID,
    });
    await expect(
      addresses.create(ACCOUNT_A, {
        label: 'Bad',
        addressText: 'Bad',
        latitude: 36,
        longitude: 181,
      }),
    ).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_ADDRESS_INVALID,
    });
  });

  it('requires a profile before address operations', async () => {
    await expect(addresses.list(ACCOUNT_B)).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
    });
  });
});
