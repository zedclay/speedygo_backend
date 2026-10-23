import type { AdminListQuery } from './admin.types';

export const ADMIN_ACCOUNT_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'DISABLED',
] as const;
export type AdminAccountStatus = (typeof ADMIN_ACCOUNT_STATUSES)[number];

export type AdminProfileListItem = {
  id: string;
  displayName: string;
  twoFactorEnabled: boolean;
  roleId: string;
  roleName: string;
  roleActive: boolean;
  accountId: string;
  phone: string | null;
  email: string | null;
  accountStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminProfileDetail = AdminProfileListItem & {
  permissionCodes: string[];
};

export type AdminRoleListItem = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  memberCount: number;
  permissionCount: number;
};

export type AdminRoleDetail = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  memberCount: number;
  permissionCodes: string[];
};

export type AdminPermissionCatalogItem = {
  id: string;
  code: string;
  description: string | null;
};

export type AdminProfileListQuery = AdminListQuery & {
  q?: string;
  roleId?: string;
  accountStatus?: AdminAccountStatus;
};

export type AdminRoleListQuery = AdminListQuery & {
  q?: string;
  active?: boolean;
};
