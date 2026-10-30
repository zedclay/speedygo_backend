import { Injectable } from '@nestjs/common';
import { normalizePhone } from '../../auth/domain/identity';
import {
  adminSearchPhoneDigits,
  isAdminSearchUuid,
  normalizeAdminSearchLimitPerType,
  normalizeAdminSearchQuery,
  parseAdminSearchTypes,
  resolvePermittedSearchTypes,
  type AdminSearchEntityType,
} from '../domain/admin-search.policy';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminSearchRepository } from '../infrastructure/admin-search.repository';

export type AdminSearchEmptyReason =
  | 'QUERY_REQUIRED'
  | 'NO_SEARCHABLE_PERMISSIONS'
  | 'NO_MATCHES'
  | null;

export type AdminSearchResponse = {
  query: string;
  normalizedQuery: string | null;
  permittedTypes: AdminSearchEntityType[];
  groups: Array<{
    type: AdminSearchEntityType;
    total: number;
    limit: number;
    items: unknown[];
  }>;
  emptyReason: AdminSearchEmptyReason;
};

@Injectable()
export class AdminSearchService {
  constructor(private readonly repo: AdminSearchRepository) {}

  async search(
    admin: CurrentAdminContext,
    input: { q?: string; types?: string; limitPerType?: number },
  ): Promise<AdminSearchResponse> {
    const requested = parseAdminSearchTypes(input.types);
    const permittedTypes = resolvePermittedSearchTypes(
      admin.permissions,
      requested,
    );
    const rawQ = typeof input.q === 'string' ? input.q : '';
    const trimmed = rawQ.trim();

    if (!trimmed) {
      return {
        query: rawQ,
        normalizedQuery: null,
        permittedTypes,
        groups: [],
        emptyReason: 'QUERY_REQUIRED',
      };
    }

    const normalizedQuery = normalizeAdminSearchQuery(rawQ);
    const limit = normalizeAdminSearchLimitPerType(input.limitPerType);

    if (permittedTypes.length === 0) {
      return {
        query: rawQ,
        normalizedQuery,
        permittedTypes: [],
        groups: [],
        emptyReason: 'NO_SEARCHABLE_PERMISSIONS',
      };
    }

    const phoneDigits = adminSearchPhoneDigits(normalizedQuery);
    let phoneE164: string | null = null;
    if (phoneDigits) {
      try {
        phoneE164 = normalizePhone(normalizedQuery, 'DZ');
      } catch {
        try {
          phoneE164 = normalizePhone(`0${phoneDigits.slice(-9)}`, 'DZ');
        } catch {
          phoneE164 = null;
        }
      }
    }

    const needle = {
      text: normalizedQuery,
      like: `%${normalizedQuery}%`,
      uuid: isAdminSearchUuid(normalizedQuery) ? normalizedQuery : null,
      phoneE164,
      phoneDigits,
    };

    const groups: AdminSearchResponse['groups'] = [];
    for (const type of permittedTypes) {
      const page = await this.runType(type, needle, limit);
      groups.push({
        type: page.type,
        total: page.total,
        limit: page.limit,
        items: page.items,
      });
    }

    const anyHits = groups.some((g) => g.total > 0);
    return {
      query: rawQ,
      normalizedQuery,
      permittedTypes,
      groups,
      emptyReason: anyHits ? null : 'NO_MATCHES',
    };
  }

  private runType(
    type: AdminSearchEntityType,
    needle: {
      text: string;
      like: string;
      uuid: string | null;
      phoneE164: string | null;
      phoneDigits: string | null;
    },
    limit: number,
  ) {
    switch (type) {
      case 'customers':
        return this.repo.searchCustomers(needle, limit);
      case 'merchants':
        return this.repo.searchMerchants(needle, limit);
      case 'drivers':
        return this.repo.searchDrivers(needle, limit);
      case 'orders':
        return this.repo.searchOrders(needle, limit);
      case 'support':
        return this.repo.searchSupport(needle, limit);
      default: {
        const _exhaustive: never = type;
        return _exhaustive;
      }
    }
  }
}
