import { MERCHANT_CAPABILITIES } from '../domain/merchant.policy';
import { OpeningHoursExceptionService } from './opening-hours-exception.service';

const accountId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const merchantId = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const branchId = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const foreignBranch = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const now = new Date('2026-10-02T10:00:00Z');

const stored = {
  id: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
  branchId,
  localDate: '2026-10-05',
  closed: false,
  label: 'Inventaire',
  customerMessage: null,
  version: 2,
  updatedByAccountId: accountId,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  intervals: [
    { opensMinute: 540, closesMinute: 780, closesNextDay: false, sortOrder: 0 },
  ],
};

describe('OpeningHoursExceptionService', () => {
  const exceptions = {
    findByDate: jest.fn(),
    findFromDate: jest.fn(),
    countFromDate: jest.fn(),
    create: jest.fn(),
    replace: jest.fn(),
    delete: jest.fn(),
  };
  const openingHours = {
    findOwnedBranch: jest.fn(),
    findScheduleByBranchId: jest.fn(),
  };
  const access = { requireCapability: jest.fn() };
  let service: OpeningHoursExceptionService;

  const body = {
    expectedVersion: 0,
    closed: false,
    intervals: [{ opens: '09:00', closes: '13:00' }],
    label: 'Inventaire',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    access.requireCapability.mockResolvedValue(undefined);
    openingHours.findOwnedBranch.mockImplementation((_m: string, b: string) =>
      Promise.resolve(b === branchId ? { id: b, merchantId } : null),
    );
    openingHours.findScheduleByBranchId.mockResolvedValue({
      id: 'sched',
      intervals: [],
    });
    exceptions.countFromDate.mockResolvedValue(0);
    service = new OpeningHoursExceptionService(
      exceptions as never,
      openingHours as never,
      access as never,
    );
  });

  it('lists from today in Africa/Algiers with MERCHANT_READ', async () => {
    exceptions.findFromDate.mockResolvedValue([stored]);
    const view = await service.list(accountId, merchantId, branchId, now);
    expect(access.requireCapability).toHaveBeenCalledWith(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_READ,
    );
    expect(exceptions.findFromDate).toHaveBeenCalledWith(
      branchId,
      '2026-10-02',
    );
    expect(view).toEqual({
      branchId,
      timezone: 'Africa/Algiers',
      today: '2026-10-02',
      items: [
        {
          date: '2026-10-05',
          closed: false,
          label: 'Inventaire',
          customerMessage: null,
          intervals: [{ opens: '09:00', closes: '13:00' }],
          version: 2,
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('requires MERCHANT_BRANCH_UPDATE for writes (STAFF rejected before any write)', async () => {
    const forbidden = new Error('MERCHANT_ROLE_FORBIDDEN');
    access.requireCapability.mockImplementation(
      (_a: string, _m: string, cap: string) =>
        cap === MERCHANT_CAPABILITIES.MERCHANT_READ
          ? Promise.resolve()
          : Promise.reject(forbidden),
    );
    await expect(
      service.put(accountId, merchantId, branchId, '2026-10-05', body, now),
    ).rejects.toBe(forbidden);
    await expect(
      service.remove(accountId, merchantId, branchId, '2026-10-05', 1),
    ).rejects.toBe(forbidden);
    expect(exceptions.create).not.toHaveBeenCalled();
    expect(exceptions.delete).not.toHaveBeenCalled();
    await expect(
      service.list(accountId, merchantId, branchId, now),
    ).resolves.toBeTruthy();
  });

  it('rejects a foreign branch', async () => {
    await expect(
      service.put(
        accountId,
        merchantId,
        foreignBranch,
        '2026-10-05',
        body,
        now,
      ),
    ).rejects.toMatchObject({ code: 'MERCHANT_BRANCH_NOT_FOUND' });
    await expect(
      service.list(accountId, merchantId, foreignBranch, now),
    ).rejects.toMatchObject({ code: 'MERCHANT_BRANCH_NOT_FOUND' });
  });

  it('requires weekly hours before an exception can be written', async () => {
    openingHours.findScheduleByBranchId.mockResolvedValue(null);
    await expect(
      service.put(accountId, merchantId, branchId, '2026-10-05', body, now),
    ).rejects.toMatchObject({
      code: 'OPENING_HOURS_EXCEPTION_WEEKLY_REQUIRED',
      httpStatus: 409,
    });
    expect(exceptions.create).not.toHaveBeenCalled();
  });

  it('creates with expectedVersion 0 and returns a 409 with the current state on a concurrent create', async () => {
    exceptions.create.mockResolvedValueOnce({
      status: 'ok',
      record: { ...stored, version: 1 },
    });
    await expect(
      service.put(accountId, merchantId, branchId, '2026-10-05', body, now),
    ).resolves.toMatchObject({ date: '2026-10-05', version: 1 });

    exceptions.create.mockResolvedValueOnce({ status: 'conflict' });
    exceptions.findByDate.mockResolvedValue(stored);
    await expect(
      service.put(accountId, merchantId, branchId, '2026-10-05', body, now),
    ).rejects.toMatchObject({
      code: 'OPENING_HOURS_EXCEPTION_VERSION_CONFLICT',
      httpStatus: 409,
      details: {
        openingHoursException: expect.objectContaining({
          date: '2026-10-05',
          version: 2,
        }),
      },
    });
  });

  it('replaces with a matching version and reports stale versions as conflicts', async () => {
    exceptions.replace.mockResolvedValueOnce({
      status: 'ok',
      record: { ...stored, version: 3 },
    });
    await expect(
      service.put(
        accountId,
        merchantId,
        branchId,
        '2026-10-05',
        { ...body, expectedVersion: 2 },
        now,
      ),
    ).resolves.toMatchObject({ version: 3 });
    expect(exceptions.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId,
        expectedVersion: 2,
        updatedByAccountId: accountId,
      }),
    );

    exceptions.replace.mockResolvedValueOnce({ status: 'conflict' });
    exceptions.findByDate.mockResolvedValue(null);
    await expect(
      service.put(
        accountId,
        merchantId,
        branchId,
        '2026-10-05',
        { ...body, expectedVersion: 7 },
        now,
      ),
    ).rejects.toMatchObject({
      code: 'OPENING_HOURS_EXCEPTION_VERSION_CONFLICT',
      details: { openingHoursException: null },
    });
  });

  it('validates before writing (invalid input never reaches the repository)', async () => {
    await expect(
      service.put(
        accountId,
        merchantId,
        branchId,
        '2026-10-05',
        { ...body, intervals: [{ opens: '22:00', closes: '02:00' }] },
        now,
      ),
    ).rejects.toMatchObject({ code: 'OPENING_HOURS_EXCEPTION_INVALID' });
    await expect(
      service.put(accountId, merchantId, branchId, '2026-09-30', body, now),
    ).rejects.toMatchObject({ code: 'OPENING_HOURS_EXCEPTION_INVALID' });
    expect(exceptions.create).not.toHaveBeenCalled();
    expect(exceptions.replace).not.toHaveBeenCalled();
  });

  it('caps upcoming exceptions per branch', async () => {
    exceptions.countFromDate.mockResolvedValue(100);
    await expect(
      service.put(accountId, merchantId, branchId, '2026-10-05', body, now),
    ).rejects.toMatchObject({ code: 'OPENING_HOURS_EXCEPTION_INVALID' });
  });

  it('deletes with a matching version; missing → 404, stale → 409', async () => {
    exceptions.delete.mockResolvedValueOnce('deleted');
    await expect(
      service.remove(accountId, merchantId, branchId, '2026-10-05', 2),
    ).resolves.toEqual({ deleted: true, date: '2026-10-05' });

    exceptions.delete.mockResolvedValueOnce('missing');
    await expect(
      service.remove(accountId, merchantId, branchId, '2026-10-05', 2),
    ).rejects.toMatchObject({
      code: 'OPENING_HOURS_EXCEPTION_NOT_FOUND',
      httpStatus: 404,
    });

    exceptions.delete.mockResolvedValueOnce('conflict');
    exceptions.findByDate.mockResolvedValue(stored);
    await expect(
      service.remove(accountId, merchantId, branchId, '2026-10-05', 1),
    ).rejects.toMatchObject({
      code: 'OPENING_HOURS_EXCEPTION_VERSION_CONFLICT',
    });

    await expect(
      service.remove(accountId, merchantId, branchId, '2026-10-05', Number.NaN),
    ).rejects.toMatchObject({ code: 'OPENING_HOURS_EXCEPTION_INVALID' });
  });
});
