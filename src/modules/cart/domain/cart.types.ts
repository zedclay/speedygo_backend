export { CART_QUANTITY_MAX } from './cart.policy';

export type CartStatus = 'ACTIVE' | 'ABANDONED' | 'CONVERTED';

export type CartRecord = {
  id: string;
  customerId: string;
  merchantBranchId: string;
  status: CartStatus;
  createdAt: string;
  updatedAt: string;
};

export type CartItemRecord = {
  id: string;
  cartId: string;
  productId: string;
  quantity: number;
  unitPriceMinor: number;
  optionIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type CartProductSnapshot = {
  productId: string;
  name: string;
  merchantId: string;
  merchantBranchId: string;
  categoryId: string;
  categoryActive: boolean;
  productAvailable: boolean;
  livePriceMinor: number;
  merchantStatus: string;
  merchantVerifiedAt: string | null;
  merchantName: string;
  branchOperationalStatus: string;
  merchantOperationalReady: boolean;
  groups: Array<{
    id: string;
    required: boolean;
    minSelections: number;
    maxSelections: number;
  }>;
  options: Array<{
    id: string;
    optionGroupId: string;
    name: string;
    available: boolean;
    additionalPriceMinor: number;
  }>;
};

export type CartWarningCode =
  | 'CART_PRODUCT_NOT_AVAILABLE'
  | 'CART_REQUIRED_OPTION_MISSING'
  | 'CART_OPTION_NOT_AVAILABLE'
  | 'CART_OPTION_INVALID';

export type CartItemView = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  baseUnitPriceMinor: number;
  optionUnitAdditionalMinor: number;
  unitPriceMinor: number;
  lineSubtotalMinor: number;
  storedUnitPriceMinor: number;
  itemAvailable: boolean;
  selectedOptions: Array<{
    optionId: string;
    name: string | null;
    additionalPriceMinor: number;
    available: boolean;
  }>;
  warnings: CartWarningCode[];
};

export type CartView = {
  id: string;
  status: CartStatus;
  branchId: string;
  merchantId: string;
  itemCount: number;
  cartSubtotalMinor: number;
  cartReady: boolean;
  warnings: CartWarningCode[];
  items: CartItemView[];
  createdAt: string;
  updatedAt: string;
};

export type CartBootstrapView = {
  cartExists: boolean;
  cart: CartView | null;
};

export type AddCartItemInput = {
  productId: string;
  quantity: number;
  optionIds: string[];
};

export type UpdateCartItemInput = {
  quantity: number;
  optionIds?: string[];
};
