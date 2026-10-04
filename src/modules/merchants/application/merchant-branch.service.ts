import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthError } from '../../auth/domain/auth.errors';
import { normalizePhone } from '../../auth/domain/identity';
import { GeoService } from '../../geo/application/geo.service';
import {
  merchantBranchInvalid,
  merchantBranchNotFound,
} from '../domain/merchant.errors';
import {
  BRANCH_DESCRIPTION_MAX_LENGTH,
  BRANCH_NAME_AR_MAX_LENGTH,
  MERCHANT_CAPABILITIES,
  normalizeOptionalBranchText,
  normalizeOptionalPublicEmail,
} from '../domain/merchant.policy';
import {
  hasValidCoordinates,
  toBranchView,
  type CreateBranchInput,
  type MerchantBranchRecord,
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
    private readonly geo: GeoService,
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
    return { branches: await this.toViews(branches) };
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
    const names = await this.geo.assertValidPair(
      input.wilayaCode,
      input.communeId,
    );
    const created = await this.merchants.createBranch(merchantId, {
      ...input,
      phone,
    });
    return toBranchView(created, names);
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

    const adminTouched =
      input.wilayaCode !== undefined || input.communeId !== undefined;
    let displayNames:
      { wilayaNameFr: string | null; communeNameFr: string | null } | undefined;
    let patch: UpdateBranchInput = {
      ...input,
      phone: input.phone !== undefined ? phone : undefined,
      description: normalizeOptionalBranchText(
        input.description,
        BRANCH_DESCRIPTION_MAX_LENGTH,
        merchantBranchInvalid,
        'description',
      ),
      nameAr: normalizeOptionalBranchText(
        input.nameAr,
        BRANCH_NAME_AR_MAX_LENGTH,
        merchantBranchInvalid,
        'nameAr',
      ),
      publicEmail: normalizeOptionalPublicEmail(
        input.publicEmail,
        merchantBranchInvalid,
      ),
    };
    if (adminTouched) {
      const nextWilaya =
        input.wilayaCode !== undefined ? input.wilayaCode : existing.wilayaCode;
      const nextCommune =
        input.communeId !== undefined ? input.communeId : existing.communeId;
      const validated = await this.geo.assertValidPair(nextWilaya, nextCommune);
      patch = {
        ...patch,
        wilayaCode: nextWilaya ?? undefined,
        communeId: nextCommune ?? undefined,
      };
      displayNames = validated;
    }

    const updated = await this.merchants.updateBranch(
      merchantId,
      branchId,
      patch,
    );
    if (!updated) {
      throw merchantBranchNotFound();
    }
    if (displayNames) {
      const classifications = await this.merchants.listBranchClassifications([
        updated.id,
      ]);
      return toBranchView(
        updated,
        displayNames,
        classifications.get(updated.id) ?? null,
      );
    }
    const [view] = await this.toViews([updated]);
    return view;
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

  private async toViews(
    branches: MerchantBranchRecord[],
  ): Promise<MerchantBranchView[]> {
    const [names, classifications] = await Promise.all([
      this.geo.resolveDisplayNamesForBranches(branches),
      this.merchants.listBranchClassifications(
        branches.map((branch) => branch.id),
      ),
    ]);
    return branches.map((branch) => {
      const key = `${branch.wilayaCode ?? ''}:${branch.communeId ?? ''}`;
      return toBranchView(
        branch,
        names.get(key),
        classifications.get(branch.id) ?? null,
      );
    });
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
