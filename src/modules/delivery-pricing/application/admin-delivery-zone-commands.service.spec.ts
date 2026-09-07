/**
 * Unit tests: audit rollback on zone and pricing-rule commands.
 *
 * When the AuditLog write fails inside the transaction the whole transaction
 * must roll back — the domain mutation must NOT persist.
 */

import { AdminDeliveryZoneCommandsService } from './admin-delivery-zone-commands.service';
import { AdminDeliveryPricingRuleCommandsService } from './admin-delivery-pricing-rule-commands.service';
import type { CurrentAdminContext } from '../../admin/domain/admin.types';
import { adminAuditFailed } from '../../admin/domain/admin.errors';
import { AdminError } from '../../admin/domain/admin.errors';
import type { DeliveryZoneRecord } from '../domain/delivery-pricing.types';

const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

const ADMIN_CTX: CurrentAdminContext = {
  adminProfileId: 'admin-1',
  accountId: 'account-1',
  sessionId: 'session-1',
  displayName: 'Test Admin',
  roleId: 'role-1',
  roleName: 'superadmin',
  permissions: [],
};

const MOCK_ZONE: DeliveryZoneRecord = {
  id: 'zone-1',
  name: 'Test Zone',
  geometryGeoJson:
    '{"type":"MultiPolygon","coordinates":[[' +
    JSON.stringify(COVERING_RING) +
    ']]}',
  active: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('AdminDeliveryZoneCommandsService — audit rollback', () => {
  it('rolls back zone create when audit write throws', async () => {
    let domainCreateCalled = false;

    const mockTx = { __tx: true };
    const mockPrisma = {
      getDb: () => ({
        transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn(mockTx),
      }),
    };
    const mockZoneService = {
      createZoneInTx: jest.fn(() => {
        domainCreateCalled = true;
        return Promise.resolve(MOCK_ZONE);
      }),
      updateZoneInTx: jest.fn(),
      activateZoneInTx: jest.fn(),
      deactivateZoneInTx: jest.fn(),
    };
    const mockZoneRepo = {
      requireById: jest.fn(() => Promise.resolve(MOCK_ZONE)),
      findById: jest.fn(() => Promise.resolve(MOCK_ZONE)),
    };
    const mockAudit = {
      recordInTx: jest.fn(() => {
        throw adminAuditFailed('Simulated audit failure');
      }),
    };

    const svc = new AdminDeliveryZoneCommandsService(
      mockPrisma as never,
      mockZoneService as never,
      mockZoneRepo as never,
      mockAudit as never,
    );

    await expect(
      svc.create(ADMIN_CTX, {
        name: 'Zone A',
        rawGeometry: { type: 'Polygon', coordinates: [COVERING_RING] },
      }),
    ).rejects.toThrow(AdminError);

    // Domain create was called but since the transaction threw, mutation is rolled back.
    expect(domainCreateCalled).toBe(true);
    expect(mockAudit.recordInTx).toHaveBeenCalledTimes(1);
  });
});

describe('AdminDeliveryPricingRuleCommandsService — audit rollback', () => {
  it('rolls back rule create when audit write throws', async () => {
    let domainCreateCalled = false;

    const MOCK_RULE = {
      id: 'rule-1',
      zoneId: 'zone-1',
      name: 'All Day',
      timeBand: 'DAY',
      startLocalTime: null,
      endLocalTime: null,
      customerDeliveryFeeMinor: 500n,
      driverRemunerationMinor: 300n,
      effectiveFrom: new Date().toISOString(),
      effectiveTo: null,
      active: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockTx = { __tx: true };
    const mockPrisma = {
      getDb: () => ({
        transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn(mockTx),
      }),
    };
    const mockRuleService = {
      createRuleInTx: jest.fn(() => {
        domainCreateCalled = true;
        return Promise.resolve(MOCK_RULE);
      }),
      activateRuleInTx: jest.fn(),
      deactivateRuleInTx: jest.fn(),
    };
    // AdminDeliveryPricingRuleCommandsService constructor: (prisma, ruleService, audit)
    const mockAudit = {
      recordInTx: jest.fn(() => {
        throw adminAuditFailed('Simulated audit failure');
      }),
    };

    const svc = new AdminDeliveryPricingRuleCommandsService(
      mockPrisma as never,
      mockRuleService as never,
      mockAudit as never,
    );

    await expect(
      svc.create(ADMIN_CTX, {
        zoneId: 'zone-1',
        name: 'All Day',
        timeBand: 'DAY',
        startLocalTime: null,
        endLocalTime: null,
        customerDeliveryFeeMinor: 500n,
        driverRemunerationMinor: 300n,
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveTo: null,
      }),
    ).rejects.toThrow(AdminError);

    expect(domainCreateCalled).toBe(true);
    expect(mockAudit.recordInTx).toHaveBeenCalledTimes(1);
  });
});
