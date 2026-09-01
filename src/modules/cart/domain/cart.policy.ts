import {
  CATALOG_PRICE_MINOR_MAX,
  isProductCustomerOfferable,
} from '../../catalog/domain/catalog.policy';
import {
  cartInvalidQuantity,
  cartOptionInvalid,
  cartOptionNotAvailable,
  cartRequiredOptionMissing,
} from './cart.errors';

export const CART_STATUS_ACTIVE = 'ACTIVE';
export const CART_STATUS_ABANDONED = 'ABANDONED';
export const CART_STATUS_CONVERTED = 'CONVERTED';

export const CART_QUANTITY_MIN = 1;
/** API abuse cap. Not a frozen business truth. */
export const CART_QUANTITY_MAX = 99;

export function requireCartQuantity(quantity: number): void {
  if (
    !Number.isInteger(quantity) ||
    quantity < CART_QUANTITY_MIN ||
    quantity > CART_QUANTITY_MAX
  ) {
    throw cartInvalidQuantity();
  }
}

export function multiplyMinorUnits(
  unitMinor: number,
  quantity: number,
): number {
  if (
    !Number.isInteger(unitMinor) ||
    !Number.isInteger(quantity) ||
    unitMinor < 0 ||
    quantity < 1
  ) {
    throw cartInvalidQuantity('Quantity and unit price must be valid integers');
  }
  const total = unitMinor * quantity;
  if (
    !Number.isSafeInteger(total) ||
    total > CATALOG_PRICE_MINOR_MAX * CART_QUANTITY_MAX
  ) {
    throw cartInvalidQuantity('Cart line total exceeds the safe integer range');
  }
  return total;
}

export type CartOptionGroupInput = {
  id: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
};

export type CartOptionInput = {
  id: string;
  optionGroupId: string;
  available: boolean;
  additionalPriceMinor: number;
  name: string;
};

/**
 * Validates option intent against live Catalog rules before persistence.
 */
export function validateCartOptionSelections(input: {
  groups: CartOptionGroupInput[];
  options: CartOptionInput[];
  selectedOptionIds: string[];
}): { additionalPriceMinor: number } {
  const uniqueIds = new Set(input.selectedOptionIds);
  if (uniqueIds.size !== input.selectedOptionIds.length) {
    throw cartOptionInvalid('Duplicate option ids are not allowed');
  }
  const optionsById = new Map(
    input.options.map((option) => [option.id, option]),
  );
  const selected: CartOptionInput[] = [];
  for (const optionId of input.selectedOptionIds) {
    const option = optionsById.get(optionId);
    if (!option) {
      throw cartOptionInvalid('Option does not belong to this Product');
    }
    if (!option.available) {
      throw cartOptionNotAvailable();
    }
    selected.push(option);
  }
  const selectedByGroup = new Map<string, number>();
  for (const option of selected) {
    selectedByGroup.set(
      option.optionGroupId,
      (selectedByGroup.get(option.optionGroupId) ?? 0) + 1,
    );
  }
  for (const group of input.groups) {
    const count = selectedByGroup.get(group.id) ?? 0;
    if (group.required && count < group.minSelections) {
      throw cartRequiredOptionMissing();
    }
    if (count > group.maxSelections) {
      throw cartOptionInvalid('Option group maxSelections exceeded');
    }
  }
  const additionalPriceMinor = selected.reduce(
    (sum, option) => sum + option.additionalPriceMinor,
    0,
  );
  if (!Number.isInteger(additionalPriceMinor) || additionalPriceMinor < 0) {
    throw cartOptionInvalid('Option additional price is invalid');
  }
  return { additionalPriceMinor };
}

export function requiredOptionGroupsSatisfiable(input: {
  groups: CartOptionGroupInput[];
  options: CartOptionInput[];
}): boolean {
  const availableByGroup = new Map<string, number>();
  for (const option of input.options) {
    if (!option.available) {
      continue;
    }
    availableByGroup.set(
      option.optionGroupId,
      (availableByGroup.get(option.optionGroupId) ?? 0) + 1,
    );
  }
  for (const group of input.groups) {
    if (!group.required) {
      continue;
    }
    if ((availableByGroup.get(group.id) ?? 0) < group.minSelections) {
      return false;
    }
  }
  return true;
}

export function isCartProductOfferable(input: {
  merchantOperationalReady: boolean;
  branchOperationalStatus: string;
  categoryActive: boolean;
  productAvailable: boolean;
}): boolean {
  return isProductCustomerOfferable(input);
}

export function normalizeOptionIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

export function optionSetsEqual(left: string[], right: string[]): boolean {
  const a = normalizeOptionIds(left);
  const b = normalizeOptionIds(right);
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export type CartSelectionView = {
  optionId: string;
  name: string | null;
  additionalPriceMinor: number;
  available: boolean;
};

export function evaluatePersistedSelections(input: {
  groups: CartOptionGroupInput[];
  options: CartOptionInput[];
  selectedOptionIds: string[];
}): {
  additionalPriceMinor: number;
  warnings: Array<
    | 'CART_REQUIRED_OPTION_MISSING'
    | 'CART_OPTION_NOT_AVAILABLE'
    | 'CART_OPTION_INVALID'
  >;
  selected: CartSelectionView[];
} {
  const warningSet = new Set<
    | 'CART_REQUIRED_OPTION_MISSING'
    | 'CART_OPTION_NOT_AVAILABLE'
    | 'CART_OPTION_INVALID'
  >();
  const optionsById = new Map(
    input.options.map((option) => [option.id, option]),
  );
  const selected: CartSelectionView[] = [];
  const availableSelectedIds: string[] = [];
  for (const optionId of normalizeOptionIds(input.selectedOptionIds)) {
    const option = optionsById.get(optionId);
    if (!option) {
      warningSet.add('CART_OPTION_NOT_AVAILABLE');
      selected.push({
        optionId,
        name: null,
        additionalPriceMinor: 0,
        available: false,
      });
      continue;
    }
    if (!option.available) {
      warningSet.add('CART_OPTION_NOT_AVAILABLE');
    } else {
      availableSelectedIds.push(option.id);
    }
    selected.push({
      optionId: option.id,
      name: option.name,
      additionalPriceMinor: option.additionalPriceMinor,
      available: option.available,
    });
  }
  try {
    validateCartOptionSelections({
      groups: input.groups,
      options: input.options,
      selectedOptionIds: availableSelectedIds,
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      code === 'CART_REQUIRED_OPTION_MISSING' ||
      code === 'CART_OPTION_NOT_AVAILABLE' ||
      code === 'CART_OPTION_INVALID'
    ) {
      warningSet.add(code);
    }
  }
  const additionalPriceMinor = selected
    .filter((row) => row.name !== null)
    .reduce((sum, row) => sum + row.additionalPriceMinor, 0);
  return {
    additionalPriceMinor,
    warnings: [...warningSet],
    selected,
  };
}
