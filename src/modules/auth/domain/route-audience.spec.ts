import { requiredAudienceForPath } from './route-audience';

describe('requiredAudienceForPath', () => {
  it('maps app resource prefixes', () => {
    expect(requiredAudienceForPath('/api/v1/customer/me')).toBe('CUSTOMER');
    expect(requiredAudienceForPath('/merchant/123/orders')).toBe('MERCHANT');
    expect(requiredAudienceForPath('/driver/location')).toBe('DRIVER');
    expect(requiredAudienceForPath('/admin/orders')).toBe('ADMIN');
  });

  it('leaves session restore and shared geo unmapped', () => {
    expect(requiredAudienceForPath('/api/v1/auth/me')).toBeNull();
    expect(requiredAudienceForPath('/auth/sessions')).toBeNull();
    expect(requiredAudienceForPath('/auth/refresh')).toBeNull();
    expect(requiredAudienceForPath('/geo/wilayas')).toBeNull();
  });
});
