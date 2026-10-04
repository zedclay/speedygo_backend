import { MERCHANT_CAPABILITIES } from '../domain/merchant.policy';
import { MerchantBranchLogoService } from './merchant-branch-logo.service';

const accountId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const merchantId = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const branchA = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const foreignBranch = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const previousObject = '11111111111111111111111111111111';
const nextObject = '22222222222222222222222222222222';

describe('MerchantBranchLogoService', () => {
  const access = { requireCapability: jest.fn() };
  const merchants = { findOwnedBranch: jest.fn() };
  const logos = {
    upsert: jest.fn(),
    deleteByBranch: jest.fn(),
    findByBranch: jest.fn(),
    findByObjectId: jest.fn(),
  };
  const media = {
    uploadPendingLogo: jest.fn(),
    promotePendingLogo: jest.fn(),
    deleteLogo: jest.fn(),
    readLogo: jest.fn(),
    uploadPending: jest.fn(),
    promotePending: jest.fn(),
    deleteCover: jest.fn(),
  };

  let service: MerchantBranchLogoService;

  const promoted = {
    objectId: nextObject,
    contentType: 'image/png',
    byteSize: 12,
    widthPx: 256,
    heightPx: 256,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    access.requireCapability.mockResolvedValue(undefined);
    merchants.findOwnedBranch.mockImplementation(
      (_merchant: string, branchId: string) =>
        Promise.resolve(branchId === branchA ? { id: branchId } : null),
    );
    media.deleteLogo.mockResolvedValue(undefined);
    service = new MerchantBranchLogoService(
      access as never,
      merchants as never,
      logos as never,
      media as never,
    );
  });

  it('requires MERCHANT_BRANCH_UPDATE and uses the logo purpose pipeline', async () => {
    await service.uploadContent(accountId, merchantId, branchA, {
      body: Buffer.alloc(1),
    });
    expect(access.requireCapability).toHaveBeenCalledWith(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_BRANCH_UPDATE,
    );
    expect(media.uploadPendingLogo).toHaveBeenCalledWith(
      { accountId, merchantId, branchId: branchA },
      expect.any(Object),
    );
    expect(media.uploadPending).not.toHaveBeenCalled();
  });

  it('rejects STAFF mutations before touching storage', async () => {
    const forbidden = new Error('MERCHANT_ROLE_FORBIDDEN');
    access.requireCapability.mockRejectedValue(forbidden);
    await expect(
      service.uploadContent(accountId, merchantId, branchA, {
        body: Buffer.alloc(1),
      }),
    ).rejects.toBe(forbidden);
    await expect(
      service.bind(accountId, merchantId, branchA, 'sg-upload:v1:ref'),
    ).rejects.toBe(forbidden);
    await expect(service.remove(accountId, merchantId, branchA)).rejects.toBe(
      forbidden,
    );
    expect(media.uploadPendingLogo).not.toHaveBeenCalled();
    expect(media.promotePendingLogo).not.toHaveBeenCalled();
    expect(logos.deleteByBranch).not.toHaveBeenCalled();
  });

  it('rejects a foreign branch with MERCHANT_BRANCH_NOT_FOUND', async () => {
    await expect(
      service.bind(accountId, merchantId, foreignBranch, 'sg-upload:v1:ref'),
    ).rejects.toMatchObject({ code: 'MERCHANT_BRANCH_NOT_FOUND' });
    await expect(
      service.readForMerchant(accountId, merchantId, foreignBranch),
    ).rejects.toMatchObject({ code: 'MERCHANT_BRANCH_NOT_FOUND' });
    expect(media.promotePendingLogo).not.toHaveBeenCalled();
  });

  it('lets read-only roles stream with MERCHANT_READ and returns the object version', async () => {
    logos.findByBranch.mockResolvedValue({
      objectId: nextObject,
      contentType: 'image/png',
    });
    media.readLogo.mockResolvedValue({
      body: Buffer.from('png'),
      contentType: 'application/octet-stream',
    });
    const file = await service.readForMerchant(accountId, merchantId, branchA);
    expect(access.requireCapability).toHaveBeenCalledWith(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_READ,
    );
    expect(file).toEqual({
      body: Buffer.from('png'),
      contentType: 'image/png',
      version: nextObject,
    });
  });

  it('reports STORAGE_OBJECT_MISSING when no logo is bound', async () => {
    logos.findByBranch.mockResolvedValue(null);
    await expect(
      service.readForMerchant(accountId, merchantId, branchA),
    ).rejects.toMatchObject({ code: 'STORAGE_OBJECT_MISSING' });
  });

  it('deletes the promoted object, never the previous one, when the bind write fails', async () => {
    media.promotePendingLogo.mockResolvedValue(promoted);
    logos.upsert.mockRejectedValue(new Error('db write failed'));
    logos.findByObjectId.mockResolvedValue(null);
    await expect(
      service.bind(accountId, merchantId, branchA, 'sg-upload:v1:ref'),
    ).rejects.toThrow('db write failed');
    expect(media.deleteLogo).toHaveBeenCalledWith(nextObject);
    expect(media.deleteLogo).not.toHaveBeenCalledWith(previousObject);
  });

  it('deletes only an unreferenced previous logo after a replace', async () => {
    media.promotePendingLogo.mockResolvedValue(promoted);
    logos.upsert.mockResolvedValue({
      previous: { objectId: previousObject },
      current: { objectId: nextObject, ...promoted },
    });
    logos.findByObjectId.mockResolvedValue(null);
    const result = await service.bind(
      accountId,
      merchantId,
      branchA,
      'sg-upload:v1:ref',
    );
    expect(media.deleteLogo).toHaveBeenCalledWith(previousObject);
    expect(media.deleteLogo).not.toHaveBeenCalledWith(nextObject);
    expect(result).toMatchObject({
      branchId: branchA,
      logoImageUrl: `/merchant/${merchantId}/branches/${branchA}/logo`,
      logoVersion: nextObject,
    });
  });

  it('keeps a previous logo object that is still referenced', async () => {
    media.promotePendingLogo.mockResolvedValue(promoted);
    logos.upsert.mockResolvedValue({
      previous: { objectId: previousObject },
      current: { objectId: nextObject, ...promoted },
    });
    logos.findByObjectId.mockResolvedValue({ objectId: previousObject });
    await service.bind(accountId, merchantId, branchA, 'sg-upload:v1:ref');
    expect(media.deleteLogo).not.toHaveBeenCalled();
  });

  it('removes metadata then the unreferenced object; missing logo is idempotent', async () => {
    logos.deleteByBranch.mockResolvedValueOnce({ objectId: previousObject });
    logos.findByObjectId.mockResolvedValue(null);
    await expect(
      service.remove(accountId, merchantId, branchA),
    ).resolves.toEqual({ deleted: true });
    expect(media.deleteLogo).toHaveBeenCalledWith(previousObject);

    media.deleteLogo.mockClear();
    logos.deleteByBranch.mockResolvedValueOnce(null);
    await expect(
      service.remove(accountId, merchantId, branchA),
    ).resolves.toEqual({ deleted: true });
    expect(media.deleteLogo).not.toHaveBeenCalled();
    expect(media.deleteCover).not.toHaveBeenCalled();
  });
});
