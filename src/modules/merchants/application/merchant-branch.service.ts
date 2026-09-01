import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthError } from '../../auth/domain/auth.errors';
import { normalizePhone } from '../../auth/domain/identity';
import {
  merchantBranchInvalid,
  merchantBranchNotFound,
} from '../domain/merchant.errors';
import { MERCHANT_CAPABILITIES } from '../domain/merchant.policy';
import {
  hasValidCoordinates,
  toBranchView,
  type CreateBranchInput,
  type MerchantBranchView,
  type UpdateBranchInput,
} from '../domain/merchant.types';
import { MerchantRepository } from '../infrastructure/merchant.repository';
import { MerchantAccessService } from './merchant-access.service';

@Injectable()
export class MerchantBranchService {
  constructor(
    private readonly merchants: MerchantRepository,
    private readonly access: MerchantAccessService,
    private readonly config: ConfigService,
  ) {}

  async list(
    accountId: string,
    merchantId: string,
  ): Promise<{ branches: MerchantBranchView[] }> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_READ,
    );
    const branches = await this.merchants.listBranches(merchantId);
    return { branches: branches.map(toBranchView) };
  }

  async create(
    accountId: string,
    merchantId: string,
    input: CreateBranchInput,
  ): Promise<MerchantBranchView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_BRANCH_CREATE,
    );
    const phone = this.normalizeBranchPhone(input.phone);
    this.assertCoordinates(input.latitude, input.longitude);
    const created = await this.merchants.createBranch(merchantId, {
      ...input,
      phone,
    });
    return toBranchView(created);
  }

  async update(
    accountId: string,
    merchantId: string,
    branchId: string,
    input: UpdateBranchInput,
  ): Promise<MerchantBranchView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_BRANCH_UPDATE,
    );
    const existing = await this.merchants.findOwnedBranch(merchantId, branchId);
    if (!existing) {
      throw merchantBranchNotFound();
    }
    const phone =
      input.phone !== undefined
        ? this.normalizeBranchPhone(input.phone)
        : existing.phone;
    const latitude = input.latitude ?? existing.latitude;
    const longitude = input.longitude ?? existing.longitude;
    this.assertCoordinates(latitude, longitude);
    const updated = await this.merchants.updateBranch(merchantId, branchId, {
      ...input,
      phone: input.phone !== undefined ? phone : undefined,
    });
    if (!updated) {
      throw merchantBranchNotFound();
    }
    return toBranchView(updated);
  }

  async remove(
    accountId: string,
    merchantId: string,
    branchId: string,
  ): Promise<{ deleted: true }> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_BRANCH_DELETE,
    );
    const deleted = await this.merchants.deleteBranchGuarded(
      merchantId,
      branchId,
    );
    if (!deleted) {
      throw merchantBranchNotFound();
    }
    return { deleted: true };
  }

  private normalizeBranchPhone(raw: string): string {
    try {
      return normalizePhone(
        raw,
        this.config.get<string>('auth.defaultCountry', 'DZ'),
      );
    } catch (error) {
      if (error instanceof AuthError) {
        throw merchantBranchInvalid('Invalid phone number');
      }
      throw error;
    }
  }

  private assertCoordinates(latitude: number, longitude: number): void {
    if (!hasValidCoordinates(latitude, longitude)) {
      throw merchantBranchInvalid('Coordinates are outside the allowed range');
    }
  }
}
