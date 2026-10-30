import {
  normalizeCustomerNoteBody,
  parseCustomerNoteCategory,
} from './customer-internal-notes.policy';

describe('customer-internal-notes.policy', () => {
  it('parses allowlisted categories case-insensitively', () => {
    expect(parseCustomerNoteCategory('general')).toBe('GENERAL');
    expect(parseCustomerNoteCategory(' SECURITY ')).toBe('SECURITY');
  });

  it('rejects unknown categories', () => {
    expect(() => parseCustomerNoteCategory('OPS')).toThrow(
      expect.objectContaining({ code: 'ADMIN_INVALID_INPUT' }),
    );
  });

  it('normalizes body bounds', () => {
    expect(normalizeCustomerNoteBody('  hi  ')).toBe('hi');
    expect(() => normalizeCustomerNoteBody('')).toThrow(
      expect.objectContaining({ code: 'ADMIN_INVALID_INPUT' }),
    );
    expect(() => normalizeCustomerNoteBody('x'.repeat(4001))).toThrow(
      expect.objectContaining({ code: 'ADMIN_INVALID_INPUT' }),
    );
  });
});
