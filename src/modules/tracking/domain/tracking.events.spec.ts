import {
  TRACKING_NAMESPACE,
  customerTrackingRoom,
  driverTrackingRoom,
  merchantTrackingRoom,
} from './tracking.events';

describe('tracking rooms', () => {
  it('uses the frozen /realtime namespace and actor-scoped room names', () => {
    expect(TRACKING_NAMESPACE).toBe('/realtime');
    expect(customerTrackingRoom('del-1', 'cus-1')).toBe(
      'tracking:delivery:del-1:customer:cus-1',
    );
    expect(merchantTrackingRoom('del-1', 'mer-1')).toBe(
      'tracking:delivery:del-1:merchant:mer-1',
    );
    expect(driverTrackingRoom('del-1', 'drv-1')).toBe(
      'tracking:delivery:del-1:driver:drv-1',
    );
    expect(driverTrackingRoom('del-1', 'drv-old')).not.toBe(
      driverTrackingRoom('del-1', 'drv-new'),
    );
  });
});
