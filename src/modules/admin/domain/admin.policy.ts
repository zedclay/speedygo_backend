import {
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  ADMIN_LIST_MAX_OFFSET,
  type AdminListQuery,
} from './admin.types';

export function normalizeListQuery(input: {
  limit?: number;
  offset?: number;
}): AdminListQuery {
  const limit =
    input.limit === undefined
      ? ADMIN_LIST_DEFAULT_LIMIT
      : Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, Math.floor(input.limit)));
  const rawOffset =
    input.offset === undefined ? 0 : Math.max(0, Math.floor(input.offset));
  const offset = Math.min(ADMIN_LIST_MAX_OFFSET, rawOffset);
  return { limit, offset };
}
