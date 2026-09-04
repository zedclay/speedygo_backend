import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createUuidV7 } from '../src/common/utils/uuid-v7';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { PrismaService } from '../src/infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { PermissionService } from '../src/modules/authorization/permission.service';
import { ADMIN_PERMISSIONS } from '../src/modules/admin/domain/admin-permissions';
import { ADMIN_AUDIT_ACTIONS } from '../src/modules/admin/domain/admin-audit-actions';
import { SUPPORT_ERROR_CODES } from '../src/modules/support/domain/support.errors';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type AuthMeBody = { account: { id: string; phone: string } };
type TicketBody = {
  id: string;
  publicReference: string;
  status: string;
  priority: string;
  driverId?: string | null;
  messages?: Array<{ body: string; displayName: string | null }>;
  internalNotes?: Array<{ body: string }>;
};

describe('Support Foundation (e2e)', () => {
  jest.setTimeout(180_000);

  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;
  let permissions: PermissionService;

  const phones: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sender = app.get(OTP_SENDER);
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    permissions = app.get(PermissionService);
    const leftover = await redis.getClient().keys('auth:test:*');
    if (leftover.length > 0) {
      await redis.getClient().del(...leftover);
    }
  });

  afterAll(async () => {
    for (const phone of phones) {
      await cleanupByPhone(phone);
    }
    await app.close();
  });

  async function authenticate(phone: string): Promise<string> {
    phones.push(phone);
    const server = app.getHttpServer();
    await request(server).post('/api/v1/auth/otp/request').send({
      channel: 'PHONE',
      identifier: phone,
      purpose: 'AUTHENTICATE',
    });
    const verified = await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({
        channel: 'PHONE',
        identifier: phone,
        purpose: 'AUTHENTICATE',
        code: sender.lastCode,
        platform: 'android',
        appVersion: '1.0.0',
        deviceName: 'support-foundation-e2e',
      });
    expect(verified.status).toBe(200);
    return (verified.body as TokenBody).accessToken;
  }

  async function authMe(token: string): Promise<AuthMeBody['account']> {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return (response.body as AuthMeBody).account;
  }

  async function cleanupSupportForAccount(accountId: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    const tickets = await db.SupportTicket.where({
      createdByAccountId: accountId,
    }).all();
    const merchantTickets = await db.SupportTicket.where({}).all();
    const all = [
      ...tickets,
      ...merchantTickets.filter((t) => t.createdByAccountId === accountId),
    ];
    const seen = new Set<string>();
    for (const ticket of all) {
      if (seen.has(ticket.id)) continue;
      seen.add(ticket.id);
      for (const note of await db.SupportInternalNote.where({
        ticketId: ticket.id,
      }).all()) {
        await db.SupportInternalNote.where({ id: note.id }).delete();
      }
      for (const msg of await db.SupportMessage.where({
        ticketId: ticket.id,
      }).all()) {
        await db.SupportMessage.where({ id: msg.id }).delete();
      }
      await db.SupportTicket.where({ id: ticket.id }).delete();
    }
  }

  async function cleanupByPhone(phoneE164: string): Promise<void> {
    const db = prisma.getDb().orm.public;
    const account = await db.Account.where({ phone: phoneE164 }).first();
    if (!account) {
      return;
    }
    await cleanupSupportForAccount(account.id);

    // Also delete tickets where this account's admin was assignee / notes author
    const admin = await db.AdminProfile.where({
      accountId: account.id,
    }).first();
    if (admin) {
      for (const note of await db.SupportInternalNote.where({
        adminId: admin.id,
      }).all()) {
        await db.SupportInternalNote.where({ id: note.id }).delete();
      }
      const assigned = await db.SupportTicket.where({
        assignedAdminId: admin.id,
      }).all();
      for (const ticket of assigned) {
        await db.SupportTicket.where({ id: ticket.id }).update({
          assignedAdminId: null,
        });
      }
      const audits = await db.AuditLog.where({ adminId: admin.id }).all();
      for (const audit of audits) {
        await db.AuditLog.where({ id: audit.id }).delete();
      }
      const links = await db.RolePermission.where({
        roleId: admin.roleId,
      }).all();
      for (const link of links) {
        await db.RolePermission.where({
          roleId: link.roleId,
          permissionId: link.permissionId,
        }).delete();
      }
      await db.AdminProfile.where({ id: admin.id }).delete();
      await db.Role.where({ id: admin.roleId }).delete();
    }

    const members = await db.MerchantMember.where({
      accountId: account.id,
    }).all();
    for (const member of members) {
      const merchantTickets = await db.SupportTicket.where({
        merchantId: member.merchantId,
      }).all();
      for (const ticket of merchantTickets) {
        for (const note of await db.SupportInternalNote.where({
          ticketId: ticket.id,
        }).all()) {
          await db.SupportInternalNote.where({ id: note.id }).delete();
        }
        for (const msg of await db.SupportMessage.where({
          ticketId: ticket.id,
        }).all()) {
          await db.SupportMessage.where({ id: msg.id }).delete();
        }
        await db.SupportTicket.where({ id: ticket.id }).delete();
      }
      const docs = await db.MerchantDocument.where({
        merchantId: member.merchantId,
      }).all();
      for (const doc of docs) {
        await db.MerchantDocument.where({ id: doc.id }).delete();
      }
      const branches = await db.MerchantBranch.where({
        merchantId: member.merchantId,
      }).all();
      for (const branch of branches) {
        await db.MerchantBranch.where({ id: branch.id }).delete();
      }
      const allMembers = await db.MerchantMember.where({
        merchantId: member.merchantId,
      }).all();
      for (const m of allMembers) {
        await db.MerchantMember.where({ id: m.id }).delete();
      }
      await db.Merchant.where({ id: member.merchantId }).delete();
    }

    const customer = await db.CustomerProfile.where({
      accountId: account.id,
    }).first();
    if (customer) {
      await db.CustomerProfile.where({ id: customer.id }).delete();
    }

    const driver = await db.DriverProfile.where({
      accountId: account.id,
    }).first();
    if (driver) {
      for (const ticket of await db.SupportTicket.where({
        driverId: driver.id,
      }).all()) {
        for (const note of await db.SupportInternalNote.where({
          ticketId: ticket.id,
        }).all()) {
          await db.SupportInternalNote.where({ id: note.id }).delete();
        }
        for (const msg of await db.SupportMessage.where({
          ticketId: ticket.id,
        }).all()) {
          await db.SupportMessage.where({ id: msg.id }).delete();
        }
        await db.SupportTicket.where({ id: ticket.id }).delete();
      }
      await db.DriverProfile.where({ id: driver.id }).delete();
    }

    for (const session of await db.Session.where({
      accountId: account.id,
    }).all()) {
      await db.Session.where({ id: session.id }).delete();
    }
    for (const device of await db.Device.where({
      accountId: account.id,
    }).all()) {
      await db.Device.where({ id: device.id }).delete();
    }
    await deleteAccountNotificationArtifacts(prisma, account.id);
    await db.Account.where({ id: account.id }).delete();
  }

  async function seedAdminWithPermissions(
    accountId: string,
    suffix: string,
    codes: string[],
    options?: { active?: boolean; displayName?: string },
  ): Promise<{ adminId: string; roleId: string }> {
    const now = pgNow();
    const roleId = createUuidV7();
    await prisma.getDb().orm.public.Role.create({
      id: roleId,
      name: pgVarchar<128>(`support-e2e-${suffix}`),
      description: null,
      active: options?.active ?? true,
    });
    for (const code of codes) {
      const existing = await prisma
        .getDb()
        .orm.public.Permission.where({ code: pgVarchar<128>(code) })
        .first();
      const permissionId = existing?.id ?? createUuidV7();
      if (!existing) {
        await prisma.getDb().orm.public.Permission.create({
          id: permissionId,
          code: pgVarchar<128>(code),
          description: null,
        });
      }
      await prisma.getDb().orm.public.RolePermission.create({
        roleId,
        permissionId,
      });
    }
    const adminId = createUuidV7();
    await prisma.getDb().orm.public.AdminProfile.create({
      id: adminId,
      accountId,
      roleId,
      displayName: pgVarchar<255>(options?.displayName ?? 'Support Admin'),
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await permissions.invalidate(accountId);
    return { adminId, roleId };
  }

  it('covers customer, admin, merchant ownership and finance separation', async () => {
    const suffix = `${Date.now().toString().slice(-6)}`;
    const server = app.getHttpServer();

    const customerToken = await authenticate(`0571${suffix}`);
    const foreignToken = await authenticate(`0572${suffix}`);
    const ownerToken = await authenticate(`0573${suffix}`);
    const staffToken = await authenticate(`0574${suffix}`);
    const manageToken = await authenticate(`0575${suffix}`);
    const readToken = await authenticate(`0576${suffix}`);
    const assigneeReadToken = await authenticate(`0578${suffix}`);
    const inactiveToken = await authenticate(`0579${suffix}`);
    const assigneeManageToken = await authenticate(`0580${suffix}`);

    const customer = await authMe(customerToken);
    const foreign = await authMe(foreignToken);
    const owner = await authMe(ownerToken);
    const staff = await authMe(staffToken);
    const manageAcct = await authMe(manageToken);
    const readAcct = await authMe(readToken);
    const assigneeReadAcct = await authMe(assigneeReadToken);
    const inactiveAcct = await authMe(inactiveToken);
    const assigneeManageAcct = await authMe(assigneeManageToken);

    await request(server)
      .post('/api/v1/customer/profile')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'Support Customer' });
    await request(server)
      .post('/api/v1/customer/profile')
      .set('Authorization', `Bearer ${foreignToken}`)
      .send({ fullName: 'Foreign Customer' });

    const merchantRes = await request(server)
      .post('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Support Shop ${suffix}` });
    expect(merchantRes.status).toBe(201);
    const merchantId = (merchantRes.body as { merchantId: string }).merchantId;

    await prisma.getDb().orm.public.MerchantMember.create({
      id: createUuidV7(),
      merchantId,
      accountId: staff.id,
      role: pgVarchar<64>('STAFF'),
      createdAt: pgNow(),
    });

    const manageAdmin = await seedAdminWithPermissions(
      manageAcct.id,
      `m${suffix}`,
      [ADMIN_PERMISSIONS.SUPPORT_READ, ADMIN_PERMISSIONS.SUPPORT_MANAGE],
      { displayName: 'Support Manage Actor' },
    );
    await seedAdminWithPermissions(readAcct.id, `r${suffix}`, [
      ADMIN_PERMISSIONS.SUPPORT_READ,
    ]);
    const readOnlyAssignee = await seedAdminWithPermissions(
      assigneeReadAcct.id,
      `ar${suffix}`,
      [ADMIN_PERMISSIONS.SUPPORT_READ],
      { displayName: 'Read Only Assignee' },
    );
    const inactiveAssignee = await seedAdminWithPermissions(
      inactiveAcct.id,
      `ia${suffix}`,
      [ADMIN_PERMISSIONS.SUPPORT_MANAGE],
      { active: false, displayName: 'Inactive Role Assignee' },
    );
    const manageAssignee = await seedAdminWithPermissions(
      assigneeManageAcct.id,
      `am${suffix}`,
      [ADMIN_PERMISSIONS.SUPPORT_MANAGE],
      { displayName: 'Manage Assignee Target' },
    );

    // 1. Customer create / list / reply
    const created = await request(server)
      .post('/api/v1/customer/support')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ body: 'Need help with my order status' });
    expect(created.status).toBe(201);
    const ticket = created.body as TicketBody;
    expect(ticket.status).toBe('OPEN');
    expect(ticket.priority).toBe('NORMAL');
    expect(ticket.publicReference.startsWith('sgt_')).toBe(true);

    const listed = await request(server)
      .get('/api/v1/customer/support')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(listed.status).toBe(200);
    expect((listed.body as { total: number }).total).toBeGreaterThanOrEqual(1);

    const reply = await request(server)
      .post(`/api/v1/customer/support/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ body: 'Additional details from customer' });
    expect(reply.status).toBe(201);

    // Foreign customer blocked
    const foreignGet = await request(server)
      .get(`/api/v1/customer/support/${ticket.id}`)
      .set('Authorization', `Bearer ${foreignToken}`);
    expect(foreignGet.status).toBe(404);
    expect((foreignGet.body as ErrorBody).error.code).toBe(
      SUPPORT_ERROR_CODES.SUPPORT_NOT_FOUND,
    );

    // Foreign orderId blocked
    const fakeOrder = createUuidV7();
    const badOrder = await request(server)
      .post('/api/v1/customer/support')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ body: 'Linked to someone else', orderId: fakeOrder });
    expect(badOrder.status).toBe(403);
    expect((badOrder.body as ErrorBody).error.code).toBe(
      SUPPORT_ERROR_CODES.SUPPORT_RESOURCE_FORBIDDEN,
    );

    // 6. Actor spoof / unsupported fields rejected
    const spoof = await request(server)
      .post('/api/v1/customer/support')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        body: 'spoof attempt',
        status: 'CLOSED',
        priority: 'HIGH',
        category: 'REFUND',
        attachment: 'https://example.com/x.png',
        createdByAccountId: foreign.id,
        senderId: foreign.id,
        senderType: 'ADMIN',
      });
    expect(spoof.status).toBe(400);

    // 2. Admin with support.manage
    const adminList = await request(server)
      .get('/api/v1/admin/support')
      .set('Authorization', `Bearer ${manageToken}`);
    expect(adminList.status).toBe(200);

    const adminReply = await request(server)
      .post(`/api/v1/admin/support/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ body: 'We are looking into this' });
    expect(adminReply.status).toBe(201);
    expect((adminReply.body as { displayName: string }).displayName).toBe(
      'SpeedyGo Support',
    );

    const note = await request(server)
      .post(`/api/v1/admin/support/${ticket.id}/internal-notes`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ body: 'Internal: check payment ledger separately' });
    expect(note.status).toBe(201);

    const customerDetail = await request(server)
      .get(`/api/v1/customer/support/${ticket.id}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(customerDetail.status).toBe(200);
    expect((customerDetail.body as TicketBody).internalNotes).toBeUndefined();

    const adminDetail = await request(server)
      .get(`/api/v1/admin/support/${ticket.id}`)
      .set('Authorization', `Bearer ${manageToken}`);
    expect(adminDetail.status).toBe(200);
    expect(
      (adminDetail.body as TicketBody).internalNotes?.some((n) =>
        n.body.includes('Internal'),
      ),
    ).toBe(true);

    const assign = await request(server)
      .post(`/api/v1/admin/support/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ assignedAdminId: manageAdmin.adminId });
    expect(assign.status).toBe(201);
    expect(
      (assign.body as TicketBody & { assignedAdminId: string }).assignedAdminId,
    ).toBe(manageAdmin.adminId);

    // Assignment authority: support.read-only target blocked
    const assignReadOnly = await request(server)
      .post(`/api/v1/admin/support/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ assignedAdminId: readOnlyAssignee.adminId });
    expect(assignReadOnly.status).toBe(400);
    expect((assignReadOnly.body as ErrorBody).error.code).toBe(
      SUPPORT_ERROR_CODES.SUPPORT_INVALID_INPUT,
    );

    // Assignment authority: inactive Role blocked even with support.manage on RolePermission
    const assignInactive = await request(server)
      .post(`/api/v1/admin/support/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ assignedAdminId: inactiveAssignee.adminId });
    expect(assignInactive.status).toBe(400);

    // Assignment authority: valid support.manage target; audit actor remains manageAdmin
    const assignTarget = await request(server)
      .post(`/api/v1/admin/support/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ assignedAdminId: manageAssignee.adminId });
    expect(assignTarget.status).toBe(201);
    expect(
      (assignTarget.body as TicketBody & { assignedAdminId: string })
        .assignedAdminId,
    ).toBe(manageAssignee.adminId);

    const resolve = await request(server)
      .post(`/api/v1/admin/support/${ticket.id}/resolve`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({});
    expect(resolve.status).toBe(201);
    expect((resolve.body as TicketBody).status).toBe('RESOLVED');

    const resolvedReply = await request(server)
      .post(`/api/v1/customer/support/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ body: 'trying after resolve' });
    expect(resolvedReply.status).toBe(409);

    const close = await request(server)
      .post(`/api/v1/admin/support/${ticket.id}/close`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({});
    expect(close.status).toBe(201);
    expect((close.body as TicketBody).status).toBe('CLOSED');

    const closedReply = await request(server)
      .post(`/api/v1/customer/support/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ body: 'trying after close' });
    expect(closedReply.status).toBe(409);
    expect((closedReply.body as ErrorBody).error.code).toBe(
      SUPPORT_ERROR_CODES.SUPPORT_INVALID_STATE,
    );

    const reopen = await request(server)
      .post(`/api/v1/admin/support/${ticket.id}/reopen`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({});
    expect(reopen.status).toBe(201);
    expect((reopen.body as TicketBody).status).toBe('OPEN');

    const afterReopenReply = await request(server)
      .post(`/api/v1/customer/support/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ body: 'reply after explicit reopen' });
    expect(afterReopenReply.status).toBe(201);

    const userReopen = await request(server)
      .post(`/api/v1/admin/support/${ticket.id}/reopen`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({});
    expect(userReopen.status).toBe(403);

    const audits = await prisma
      .getDb()
      .orm.public.AuditLog.where({ adminId: manageAdmin.adminId })
      .all();
    const actions = audits.map((a) => a.action);
    expect(actions).toContain(ADMIN_AUDIT_ACTIONS.SUPPORT_ASSIGN);
    expect(actions).toContain(ADMIN_AUDIT_ACTIONS.SUPPORT_STATUS_CHANGE);
    expect(actions).toContain(ADMIN_AUDIT_ACTIONS.SUPPORT_INTERNAL_NOTE);
    const assignAudits = audits.filter(
      (a) => a.action === ADMIN_AUDIT_ACTIONS.SUPPORT_ASSIGN,
    );
    expect(assignAudits.length).toBeGreaterThanOrEqual(2);
    expect(
      assignAudits.some((a) => {
        const after = a.afterJson as { assignedAdminId?: string } | null;
        return after?.assignedAdminId === manageAssignee.adminId;
      }),
    ).toBe(true);
    // Target assignee must never appear as audit actor for these mutations
    const targetActorAudits = await prisma
      .getDb()
      .orm.public.AuditLog.where({ adminId: manageAssignee.adminId })
      .all();
    expect(targetActorAudits).toHaveLength(0);

    // 3. support.read only cannot manage
    const readManage = await request(server)
      .post(`/api/v1/admin/support/${ticket.id}/reopen`)
      .set('Authorization', `Bearer ${readToken}`)
      .send({});
    expect(readManage.status).toBe(403);

    const readGet = await request(server)
      .get(`/api/v1/admin/support/${ticket.id}`)
      .set('Authorization', `Bearer ${readToken}`);
    expect(readGet.status).toBe(200);

    // 4. support.manage alone cannot confirm refunds
    const refundConfirm = await request(server)
      .post(`/api/v1/admin/refunds/${createUuidV7()}/confirm-manual`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({});
    expect(refundConfirm.status).toBe(403);

    // 5. Merchant OWNER create; STAFF blocked
    const merchantTicket = await request(server)
      .post(`/api/v1/merchant/${merchantId}/support`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ body: 'Merchant needs ops help' });
    expect(merchantTicket.status).toBe(201);

    const staffBlocked = await request(server)
      .post(`/api/v1/merchant/${merchantId}/support`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ body: 'STAFF should fail' });
    expect(staffBlocked.status).toBe(403);
    expect((staffBlocked.body as ErrorBody).error.code).toBe(
      SUPPORT_ERROR_CODES.SUPPORT_FORBIDDEN,
    );

    // 6b. Driver create / reply / foreign driver blocked
    const driverToken = await authenticate(`0577${suffix}`);
    const driverAcct = await authMe(driverToken);
    const driverId = createUuidV7();
    const now = pgNow();
    await prisma.getDb().orm.public.DriverProfile.create({
      id: driverId,
      accountId: driverAcct.id,
      fullName: pgVarchar<255>('Support Driver'),
      verificationStatus: pgVarchar<64>('APPROVED'),
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const driverTicket = await request(server)
      .post('/api/v1/driver/support')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ body: 'Delivery issue for driver' });
    expect(driverTicket.status).toBe(201);
    expect((driverTicket.body as TicketBody).driverId).toBe(driverId);

    const driverReply = await request(server)
      .post(
        `/api/v1/driver/support/${(driverTicket.body as TicketBody).id}/messages`,
      )
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ body: 'More driver context' });
    expect(driverReply.status).toBe(201);

    const foreignDriverGet = await request(server)
      .get(`/api/v1/driver/support/${(driverTicket.body as TicketBody).id}`)
      .set('Authorization', `Bearer ${foreignToken}`);
    expect(foreignDriverGet.status).toBe(403);

    // 7. No Notification emitted for support flows
    const notifications = await prisma
      .getDb()
      .orm.public.Notification.where({ accountId: customer.id })
      .all();
    expect(
      notifications.filter((n) => String(n.category).startsWith('SUPPORT_')),
    ).toHaveLength(0);

    void owner;
  });
});
