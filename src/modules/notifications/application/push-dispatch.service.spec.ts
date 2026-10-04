import { PushDispatchService } from './push-dispatch.service';
import type { PushSendOutcome } from '../domain/push.types';

const ACCOUNT = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const ORDER = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const NOTIF = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const LOG = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const MERCHANT = 'ffffffff-ffff-7fff-8fff-ffffffffffff';
const BRANCH = '11111111-1111-7111-8111-111111111111';

function token(id: string) {
  return {
    id,
    accountId: ACCOUNT,
    deviceId: null,
    token: `fcm-token-${id}`,
    platform: 'ios',
    active: true,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  };
}

describe('PushDispatchService', () => {
  let repo: Record<string, jest.Mock>;
  let gateway: { provider: string; isConfigured: jest.Mock; send: jest.Mock };
  let service: PushDispatchService;

  beforeEach(() => {
    repo = {
      findNotificationById: jest.fn().mockResolvedValue({
        id: NOTIF,
        accountId: ACCOUNT,
        templateId: null,
        title: 'Nouvelle commande',
        body: 'Commande sgo_x',
        category: `MERCHANT_ORDER_CREATED:${ORDER}`,
        read: false,
        createdAt: '2026-09-28T00:00:00.000Z',
      }),
      findDeliveryLog: jest.fn().mockResolvedValue({
        id: LOG,
        notificationId: NOTIF,
        channel: 'PUSH',
        status: 'PENDING',
        providerReference: null,
        sentAt: null,
        createdAt: '2026-09-28T00:00:00.000Z',
      }),
      updateDeliveryLog: jest.fn().mockResolvedValue(undefined),
      findMerchantOrderPushContext: jest.fn().mockResolvedValue({
        accountStatus: 'ACTIVE',
        merchantId: MERCHANT,
        branchId: BRANCH,
        memberRole: 'STAFF',
        orderStatus: 'CREATED',
        fulfillmentStatus: 'PENDING_ACCEPTANCE',
      }),
      findActiveDeviceTokens: jest.fn().mockResolvedValue([token('t1')]),
      deactivateDeviceTokenById: jest.fn().mockResolvedValue(undefined),
    };
    gateway = {
      provider: 'fcm',
      isConfigured: jest.fn().mockReturnValue(true),
      send: jest.fn<Promise<PushSendOutcome>, unknown[]>().mockResolvedValue({
        kind: 'accepted',
        providerReference: 'fcm:projects/p/messages/1',
      }),
    };
    service = new PushDispatchService(repo as never, gateway as never);
  });

  const lastStatus = () =>
    (repo.updateDeliveryLog.mock.calls.at(-1) as [string, { status: string; providerReference: string | null; sentAt: Date | null }])[1];

  it('records PROVIDER_ACCEPTED (not SENT/DELIVERED) with provider reference', async () => {
    const r = await service.dispatch({ notificationId: NOTIF }, { finalAttempt: false });
    expect(r).toEqual({ kind: 'done', status: 'PROVIDER_ACCEPTED' });
    expect(lastStatus().providerReference).toBe('fcm:projects/p/messages/1');
    expect(lastStatus().sentAt).toBeInstanceOf(Date);
    const msg = gateway.send.mock.calls[0][0] as { data: Record<string, string>; collapseKey: string };
    expect(msg.data).toEqual({
      type: 'MERCHANT_ORDER_CREATED',
      orderId: ORDER,
      merchantId: MERCHANT,
      branchId: BRANCH,
      notificationId: NOTIF,
    });
    expect(msg.collapseKey).toBe(ORDER);
  });

  it('is idempotent: non-PENDING log is never re-sent', async () => {
    repo.findDeliveryLog.mockResolvedValue({ id: LOG, status: 'PROVIDER_ACCEPTED' });
    const r = await service.dispatch({ notificationId: NOTIF }, { finalAttempt: false });
    expect(r).toEqual({ kind: 'done', status: 'PROVIDER_ACCEPTED' });
    expect(gateway.send).not.toHaveBeenCalled();
    expect(repo.updateDeliveryLog).not.toHaveBeenCalled();
  });

  it('skips stale orders (handled or cancelled) without calling the provider', async () => {
    repo.findMerchantOrderPushContext.mockResolvedValue({
      accountStatus: 'ACTIVE',
      merchantId: MERCHANT,
      branchId: BRANCH,
      memberRole: 'OWNER',
      orderStatus: 'CANCELLED',
      fulfillmentStatus: 'PENDING_ACCEPTANCE',
    });
    await service.dispatch({ notificationId: NOTIF }, { finalAttempt: false });
    expect(lastStatus().status).toBe('SKIPPED_STALE_SOURCE');
    expect(gateway.send).not.toHaveBeenCalled();

    repo.findMerchantOrderPushContext.mockResolvedValue({
      accountStatus: 'ACTIVE',
      merchantId: MERCHANT,
      branchId: BRANCH,
      memberRole: 'OWNER',
      orderStatus: 'CONFIRMED',
      fulfillmentStatus: 'ACCEPTED',
    });
    await service.dispatch({ notificationId: NOTIF }, { finalAttempt: false });
    expect(lastStatus().status).toBe('SKIPPED_STALE_SOURCE');
  });

  it('skips recipients that lost membership or are not ACTIVE', async () => {
    repo.findMerchantOrderPushContext.mockResolvedValue({
      accountStatus: 'ACTIVE',
      merchantId: MERCHANT,
      branchId: BRANCH,
      memberRole: null,
      orderStatus: 'CREATED',
      fulfillmentStatus: 'PENDING_ACCEPTANCE',
    });
    await service.dispatch({ notificationId: NOTIF }, { finalAttempt: false });
    expect(lastStatus().status).toBe('SKIPPED_RECIPIENT_INELIGIBLE');

    repo.findMerchantOrderPushContext.mockResolvedValue({
      accountStatus: 'SUSPENDED',
      merchantId: MERCHANT,
      branchId: BRANCH,
      memberRole: 'OWNER',
      orderStatus: 'CREATED',
      fulfillmentStatus: 'PENDING_ACCEPTANCE',
    });
    await service.dispatch({ notificationId: NOTIF }, { finalAttempt: false });
    expect(lastStatus().status).toBe('SKIPPED_RECIPIENT_INELIGIBLE');
    expect(gateway.send).not.toHaveBeenCalled();
  });

  it('records SKIPPED_NO_ACTIVE_TOKEN when the recipient has no active tokens', async () => {
    repo.findActiveDeviceTokens.mockResolvedValue([]);
    await service.dispatch({ notificationId: NOTIF }, { finalAttempt: false });
    expect(lastStatus().status).toBe('SKIPPED_NO_ACTIVE_TOKEN');
  });

  it('deactivates invalid tokens by id and still accepts the healthy one', async () => {
    repo.findActiveDeviceTokens.mockResolvedValue([token('bad'), token('good')]);
    gateway.send
      .mockResolvedValueOnce({ kind: 'invalid_token', code: 'UNREGISTERED' })
      .mockResolvedValueOnce({ kind: 'accepted', providerReference: 'fcm:m/2' });
    await service.dispatch({ notificationId: NOTIF }, { finalAttempt: false });
    expect(repo.deactivateDeviceTokenById).toHaveBeenCalledWith('bad');
    expect(repo.deactivateDeviceTokenById).toHaveBeenCalledTimes(1);
    expect(lastStatus().status).toBe('PROVIDER_ACCEPTED');
  });

  it('all tokens invalid → FAILED all_tokens_invalid', async () => {
    gateway.send.mockResolvedValue({ kind: 'invalid_token', code: 'UNREGISTERED' });
    await service.dispatch({ notificationId: NOTIF }, { finalAttempt: false });
    expect(lastStatus().status).toBe('FAILED');
    expect(lastStatus().providerReference).toBe('push:all_tokens_invalid:1');
  });

  it('transient error retries without re-sending already accepted tokens', async () => {
    repo.findActiveDeviceTokens.mockResolvedValue([token('a'), token('b')]);
    gateway.send
      .mockResolvedValueOnce({ kind: 'accepted', providerReference: 'fcm:m/a' })
      .mockResolvedValueOnce({ kind: 'transient', code: 'UNAVAILABLE' });
    const first = await service.dispatch({ notificationId: NOTIF }, { finalAttempt: false });
    expect(first).toEqual({
      kind: 'retry',
      code: 'UNAVAILABLE',
      data: {
        notificationId: NOTIF,
        acceptedTokenIds: ['a'],
        firstProviderReference: 'fcm:m/a',
      },
    });
    expect(repo.updateDeliveryLog).not.toHaveBeenCalled();

    gateway.send.mockClear();
    gateway.send.mockResolvedValueOnce({ kind: 'accepted', providerReference: 'fcm:m/b' });
    if (first.kind !== 'retry') throw new Error('expected retry');
    await service.dispatch(first.data, { finalAttempt: false });
    expect(gateway.send).toHaveBeenCalledTimes(1);
    expect((gateway.send.mock.calls[0][0] as { token: string }).token).toBe('fcm-token-b');
    expect(lastStatus().status).toBe('PROVIDER_ACCEPTED');
    expect(lastStatus().providerReference).toBe('fcm:m/a');
  });

  it('final attempt with only transient errors → FAILED retry_exhausted (token kept active)', async () => {
    gateway.send.mockResolvedValue({ kind: 'transient', code: 'UNAVAILABLE' });
    const r = await service.dispatch({ notificationId: NOTIF }, { finalAttempt: true });
    expect(r).toEqual({ kind: 'done', status: 'FAILED' });
    expect(lastStatus().providerReference).toBe('push:retry_exhausted:UNAVAILABLE');
    expect(repo.deactivateDeviceTokenById).not.toHaveBeenCalled();
  });

  it('permanent provider errors fail without retry and keep the token', async () => {
    gateway.send.mockResolvedValue({ kind: 'permanent', code: 'THIRD_PARTY_AUTH_ERROR' });
    const r = await service.dispatch({ notificationId: NOTIF }, { finalAttempt: false });
    expect(r).toEqual({ kind: 'done', status: 'FAILED' });
    expect(lastStatus().providerReference).toBe('push:permanent:THIRD_PARTY_AUTH_ERROR');
    expect(repo.deactivateDeviceTokenById).not.toHaveBeenCalled();
  });

  it('provider removed after enqueue → SKIPPED_NOT_CONFIGURED', async () => {
    gateway.isConfigured.mockReturnValue(false);
    await service.dispatch({ notificationId: NOTIF }, { finalAttempt: false });
    expect(lastStatus().status).toBe('SKIPPED_NOT_CONFIGURED');
    expect(gateway.send).not.toHaveBeenCalled();
  });
});
