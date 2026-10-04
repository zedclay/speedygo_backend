import {
  generatePickupHandoffCode,
  hashPickupHandoffCode,
  pickupHandoffCodeMatches,
  sealPickupHandoffCode,
  unsealPickupHandoffCode,
} from './pickup-handoff.types';

const SECRET = 'test-pickup-handoff-secret-32-chars!!';

describe('pickup-handoff crypto', () => {
  it('generates a zero-padded 4-digit code', () => {
    const code = generatePickupHandoffCode();
    expect(code).toMatch(/^\d{4}$/);
  });

  it('hashes and verifies codes with timing-safe compare', () => {
    const code = '0123';
    const hash = hashPickupHandoffCode(SECRET, code);
    expect(pickupHandoffCodeMatches(SECRET, code, hash)).toBe(true);
    expect(pickupHandoffCodeMatches(SECRET, '9999', hash)).toBe(false);
  });

  it('seals and unseals codes for Merchant re-display', () => {
    const code = '4567';
    const sealed = sealPickupHandoffCode(SECRET, code);
    expect(unsealPickupHandoffCode(SECRET, sealed)).toBe(code);
    expect(() => unsealPickupHandoffCode('other-secret-32-chars-long!!!!!', sealed)).toThrow();
  });

  it('does not embed plaintext in sealed payload', () => {
    const code = '7890';
    const sealed = sealPickupHandoffCode(SECRET, code);
    expect(sealed).not.toContain(code);
  });
});
