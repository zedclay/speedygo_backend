import { AuthError } from './auth.errors';
import { identifierHash, normalizeEmail, normalizePhone } from './identity';

describe('identity normalization', () => {
  it('normalizes Algerian national numbers to E.164', () => {
    expect(normalizePhone('0550123456', 'DZ')).toBe('+213550123456');
  });

  it('rejects invalid phones', () => {
    expect(() => normalizePhone('12', 'DZ')).toThrow(AuthError);
  });

  it('trims and lowercases email', () => {
    expect(normalizeEmail(' User@Example.COM ')).toBe('user@example.com');
  });

  it('rejects invalid email', () => {
    expect(() => normalizeEmail('not-an-email')).toThrow(AuthError);
  });

  it('hashes identifiers without embedding the raw value', () => {
    const hash = identifierHash('+213550123456');
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain('213');
  });
});
