export type CommerceVerticalRecord = {
  id: string;
  slug: string;
  name: string;
  iconKey: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MerchantBranchClassificationRecord = {
  id: string;
  branchId: string;
  verticalId: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomerCommerceVerticalView = {
  id: string;
  slug: string;
  name: string;
  iconKey: string;
  sortOrder: number;
};
