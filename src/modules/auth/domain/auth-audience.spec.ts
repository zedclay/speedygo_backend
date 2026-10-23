import {
  AUTH_APP_HEADER,
  isAuthAudience,
  parseAuthAudience,
  readAuthAudienceHeader,
} from './auth-audience';

describe('auth audience parse', () => {
  it('accepts canonical and case-insensitive client hints', () => {
    expect(parseAuthAudience('CUSTOMER')).toBe('CUSTOMER');
    expect(parseAuthAudience('merchant')).toBe('MERCHANT');
    expect(parseAuthAudience(' Driver ')).toBe('DRIVER');
    expect(parseAuthAudience('admin')).toBe('ADMIN');
  });

  it('rejects unknown or empty values without inventing an audience', () => {
    expect(parseAuthAudience('')).toBeNull();
    expect(parseAuthAudience('web')).toBeNull();
    expect(parseAuthAudience('customer-app')).toBeNull();
    expect(isAuthAudience('CUSTOMER')).toBe(true);
    expect(isAuthAudience('CUSTOMER ')).toBe(false);
  });

  it('reads X-SpeedyGo-App from mixed-case headers', () => {
    expect(
      parseAuthAudience(
        readAuthAudienceHeader({ [AUTH_APP_HEADER]: 'customer' }),
      ),
    ).toBe('CUSTOMER');
    expect(
      parseAuthAudience(
        readAuthAudienceHeader({ 'x-speedygo-app': ['DRIVER'] }),
      ),
    ).toBe('DRIVER');
  });
});
