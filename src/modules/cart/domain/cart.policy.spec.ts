import { CART_ERROR_CODES } from './cart.errors';
import {
  evaluatePersistedSelections,
  multiplyMinorUnits,
  normalizeOptionIds,
  optionSetsEqual,
  requireCartQuantity,
  requiredOptionGroupsSatisfiable,
  validateCartOptionSelections,
} from './cart.policy';

function codeOf(run: () => void): string {
  try {
    run();
    throw new Error('expected throw');
  } catch (error) {
    return (error as { code: string }).code;
  }
}

describe('Cart policy', () => {
  it('accepts quantity 1..99 and rejects invalid quantities', () => {
    expect(() => requireCartQuantity(1)).not.toThrow();
    expect(() => requireCartQuantity(99)).not.toThrow();
    expect(codeOf(() => requireCartQuantity(0))).toBe(
      CART_ERROR_CODES.CART_INVALID_QUANTITY,
    );
    expect(codeOf(() => requireCartQuantity(100))).toBe(
      CART_ERROR_CODES.CART_INVALID_QUANTITY,
    );
    expect(codeOf(() => requireCartQuantity(1.5))).toBe(
      CART_ERROR_CODES.CART_INVALID_QUANTITY,
    );
  });

  it('multiplies integer minor units by quantity', () => {
    expect(multiplyMinorUnits(1099, 2)).toBe(2198);
    expect(multiplyMinorUnits(0, 3)).toBe(0);
  });

  it('normalizes option ids order-independently', () => {
    expect(normalizeOptionIds(['b', 'a', 'b'])).toEqual(['a', 'b']);
    expect(optionSetsEqual(['b', 'a'], ['a', 'b'])).toBe(true);
    expect(optionSetsEqual(['a'], ['a', 'b'])).toBe(false);
  });

  it('validates required and optional option selections', () => {
    const groups = [
      { id: 'g1', required: true, minSelections: 1, maxSelections: 1 },
      { id: 'g2', required: false, minSelections: 0, maxSelections: 2 },
    ];
    const options = [
      {
        id: 'o1',
        optionGroupId: 'g1',
        name: 'Large',
        available: true,
        additionalPriceMinor: 200,
      },
      {
        id: 'o2',
        optionGroupId: 'g1',
        name: 'Gone',
        available: false,
        additionalPriceMinor: 0,
      },
      {
        id: 'o3',
        optionGroupId: 'g2',
        name: 'Milk',
        available: true,
        additionalPriceMinor: 50,
      },
    ];
    expect(
      validateCartOptionSelections({
        groups,
        options,
        selectedOptionIds: ['o1'],
      }).additionalPriceMinor,
    ).toBe(200);
    expect(
      validateCartOptionSelections({
        groups,
        options,
        selectedOptionIds: ['o1', 'o3'],
      }).additionalPriceMinor,
    ).toBe(250);
    expect(
      codeOf(() =>
        validateCartOptionSelections({
          groups,
          options,
          selectedOptionIds: [],
        }),
      ),
    ).toBe(CART_ERROR_CODES.CART_REQUIRED_OPTION_MISSING);
    expect(
      codeOf(() =>
        validateCartOptionSelections({
          groups,
          options,
          selectedOptionIds: ['o2'],
        }),
      ),
    ).toBe(CART_ERROR_CODES.CART_OPTION_NOT_AVAILABLE);
    expect(
      codeOf(() =>
        validateCartOptionSelections({
          groups,
          options,
          selectedOptionIds: ['foreign'],
        }),
      ),
    ).toBe(CART_ERROR_CODES.CART_OPTION_INVALID);
    expect(
      codeOf(() =>
        validateCartOptionSelections({
          groups,
          options,
          selectedOptionIds: ['o1', 'o1'],
        }),
      ),
    ).toBe(CART_ERROR_CODES.CART_OPTION_INVALID);
    expect(
      codeOf(() =>
        validateCartOptionSelections({
          groups,
          options,
          selectedOptionIds: ['o1', 'o2'],
        }),
      ),
    ).toBe(CART_ERROR_CODES.CART_OPTION_NOT_AVAILABLE);
  });

  it('evaluates persisted selections without deleting the line', () => {
    const groups = [
      { id: 'g1', required: true, minSelections: 1, maxSelections: 1 },
    ];
    const options = [
      {
        id: 'o1',
        optionGroupId: 'g1',
        name: 'Large',
        available: true,
        additionalPriceMinor: 200,
      },
    ];
    const ready = evaluatePersistedSelections({
      groups,
      options,
      selectedOptionIds: ['o1'],
    });
    expect(ready.warnings).toEqual([]);
    expect(ready.additionalPriceMinor).toBe(200);
    const missing = evaluatePersistedSelections({
      groups,
      options,
      selectedOptionIds: [],
    });
    expect(missing.warnings).toContain('CART_REQUIRED_OPTION_MISSING');
    const gone = evaluatePersistedSelections({
      groups,
      options,
      selectedOptionIds: ['deleted'],
    });
    expect(gone.warnings).toContain('CART_OPTION_NOT_AVAILABLE');
    expect(gone.warnings).toContain('CART_REQUIRED_OPTION_MISSING');
  });

  it('detects when a required group is no longer satisfiable', () => {
    expect(
      requiredOptionGroupsSatisfiable({
        groups: [
          { id: 'g1', required: true, minSelections: 1, maxSelections: 1 },
        ],
        options: [
          {
            id: 'o1',
            optionGroupId: 'g1',
            name: 'Large',
            available: false,
            additionalPriceMinor: 0,
          },
        ],
      }),
    ).toBe(false);
    expect(
      requiredOptionGroupsSatisfiable({
        groups: [
          { id: 'g1', required: true, minSelections: 1, maxSelections: 1 },
        ],
        options: [
          {
            id: 'o1',
            optionGroupId: 'g1',
            name: 'Large',
            available: true,
            additionalPriceMinor: 0,
          },
        ],
      }),
    ).toBe(true);
  });
});
