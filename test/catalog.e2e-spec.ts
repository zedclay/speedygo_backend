import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';
import { configureApp } from '../src/app.setup';
import { createUuidV7 } from '../src/common/utils/uuid-v7';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { PrismaService } from '../src/infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type AuthMeBody = { account: { id: string; phone: string } };
type MembershipBody = { merchantId: string };
type BranchBody = { id: string };
type CategoryBody = { id: string; name: string; branchId: string };
type ProductBody = {
  id: string;
  name: string;
  priceMinor: number;
  available: boolean;
  optionGroups: Array<{ id: string }>;
};
type OptionGroupBody = { id: string; name: string };
type OptionBody = {
  id: string;
  additionalPriceMinor: number;
  available: boolean;
};
type MeBody = {
  memberships: Array<{ operationalReady: boolean; merchantId: string }>;
};

describe('Catalog foundation (e2e)', () => {
  let app: INestApplication<App>;
  let sender: TestOtpSender;
  let prisma: PrismaService;
  let redis: RedisService;

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
    const leftover = await redis.getClient().keys('auth:test:*');
    if (leftover.length > 0) {
      await redis.getClient().del(...leftover);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function authenticate(phone: string): Promise<string> {
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
        deviceName: 'catalog-e2e',
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

  async function cleanupByPhone(phoneE164: string) {
    const account = await prisma
      .getDb()
      .orm.public.Account.where({ phone: phoneE164 })
      .first();
    if (!account) {
      return;
    }
    const members = await prisma
      .getDb()
      .orm.public.MerchantMember.where({ accountId: account.id })
      .all();
    const merchantIds = [...new Set(members.map((row) => row.merchantId))];
    for (const merchantId of merchantIds) {
      const branches = await prisma
        .getDb()
        .orm.public.MerchantBranch.where({ merchantId })
        .all();
      for (const branch of branches) {
        const products = await prisma
          .getDb()
          .orm.public.Product.where({ merchantBranchId: branch.id })
          .all();
        for (const product of products) {
          await prisma
            .getDb()
            .orm.public.Product.where({ id: product.id })
            .delete();
        }
        const categories = await prisma
          .getDb()
          .orm.public.Category.where({ merchantBranchId: branch.id })
          .all();
        for (const category of categories) {
          await prisma
            .getDb()
            .orm.public.Category.where({ id: category.id })
            .delete();
        }
        await prisma
          .getDb()
          .orm.public.MerchantBranch.where({ id: branch.id })
          .delete();
      }
      const remainingMembers = await prisma
        .getDb()
        .orm.public.MerchantMember.where({ merchantId })
        .all();
      for (const member of remainingMembers) {
        await prisma
          .getDb()
          .orm.public.MerchantMember.where({ id: member.id })
          .delete();
      }
      await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantId })
        .delete();
    }
    const sessions = await prisma
      .getDb()
      .orm.public.Session.where({ accountId: account.id })
      .all();
    for (const session of sessions) {
      await prisma
        .getDb()
        .orm.public.Session.where({ id: session.id })
        .delete();
    }
    const devices = await prisma
      .getDb()
      .orm.public.Device.where({ accountId: account.id })
      .all();
    for (const device of devices) {
      await prisma.getDb().orm.public.Device.where({ id: device.id }).delete();
    }
    await deleteAccountNotificationArtifacts(prisma, account.id);

    await prisma.getDb().orm.public.Account.where({ id: account.id }).delete();
  }

  it('manages a PENDING_REVIEW catalog, isolates merchants, and enforces STAFF/SUSPENDED', async () => {
    // Historical Product deletion (CATALOG_PRODUCT_IN_USE) is covered at
    // unit/repository level. A live OrderItem e2e fixture would require
    // Customer, DeliveryZone, and Order setup, which is out of Catalog scope.
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      a: `0581${suffix}`,
      b: `0582${suffix}`,
      staff: `0583${suffix}`,
    };
    const e164: string[] = [];
    try {
      const tokenA = await authenticate(phones.a);
      const tokenB = await authenticate(phones.b);
      const tokenStaff = await authenticate(phones.staff);
      const accountA = await authMe(tokenA);
      const accountStaff = await authMe(tokenStaff);
      e164.push(
        accountA.phone,
        (await authMe(tokenB)).phone,
        accountStaff.phone,
      );

      const merchantA = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Catalog Cafe' });
      expect(merchantA.status).toBe(201);
      const merchantId = (merchantA.body as MembershipBody).merchantId;

      const noBranch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          branchId: '11111111-1111-7111-8111-111111111111',
          name: 'Drinks',
        });
      expect(noBranch.status).toBe(404);

      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Main',
          phone: '0550123456',
          addressText: 'Street A',
          latitude: 36.75,
          longitude: 3.05,
        });
      expect(branch.status).toBe(201);
      const branchId = (branch.body as BranchBody).id;

      const category = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ branchId, name: '  Drinks  ' });
      expect(category.status).toBe(201);
      const categoryBody = category.body as CategoryBody;
      expect(categoryBody.name).toBe('Drinks');
      expect(categoryBody.branchId).toBe(branchId);

      const product = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          branchId,
          categoryId: categoryBody.id,
          name: 'Coffee',
          priceMinor: 1099,
        });
      expect(product.status).toBe(201);
      const productBody = product.body as ProductBody;
      expect(productBody.priceMinor).toBe(1099);
      expect(productBody.available).toBe(true);

      const floatPrice = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          branchId,
          categoryId: categoryBody.id,
          name: 'Tea',
          priceMinor: 10.99,
        });
      expect(floatPrice.status).toBe(400);

      const group = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productBody.id}/option-groups`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Size',
          required: true,
          minSelections: 1,
          maxSelections: 1,
        });
      expect(group.status).toBe(201);
      const groupId = (group.body as OptionGroupBody).id;

      const option = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productBody.id}/option-groups/${groupId}/options`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Large', additionalPriceMinor: 200 });
      expect(option.status).toBe(201);

      const duplicateCategory = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ branchId, name: 'Drinks' });
      expect(duplicateCategory.status).toBe(201);
      expect((duplicateCategory.body as CategoryBody).id).not.toBe(
        categoryBody.id,
      );

      const duplicateProduct = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          branchId,
          categoryId: categoryBody.id,
          name: 'Coffee',
          priceMinor: 500,
        });
      expect(duplicateProduct.status).toBe(201);
      expect((duplicateProduct.body as ProductBody).id).not.toBe(
        productBody.id,
      );

      const freeItem = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          branchId,
          categoryId: categoryBody.id,
          name: 'Water',
          priceMinor: 0,
        });
      expect(freeItem.status).toBe(201);
      expect((freeItem.body as ProductBody).priceMinor).toBe(0);

      const negativePrice = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          branchId,
          categoryId: categoryBody.id,
          name: 'Bad',
          priceMinor: -1,
        });
      expect(negativePrice.status).toBe(400);

      const imageUrl = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          branchId,
          categoryId: categoryBody.id,
          name: 'Photo',
          priceMinor: 100,
          imageUrl: 'https://evil.example/x.png',
        });
      expect(imageUrl.status).toBe(400);

      const draftStatus = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          branchId,
          categoryId: categoryBody.id,
          name: 'Draft',
          priceMinor: 100,
          status: 'DRAFT',
        });
      expect(draftStatus.status).toBe(400);

      const invalidRequired = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productBody.id}/option-groups`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'BadRequired',
          required: true,
          minSelections: 0,
          maxSelections: 1,
        });
      expect(invalidRequired.status).toBe(400);

      const invalidOptional = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productBody.id}/option-groups`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'BadOptional',
          required: false,
          minSelections: 1,
          maxSelections: 2,
        });
      expect(invalidOptional.status).toBe(400);

      const invalidMax = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productBody.id}/option-groups`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'BadMax',
          required: false,
          minSelections: 0,
          maxSelections: 0,
        });
      expect(invalidMax.status).toBe(400);

      const optionalGroup = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productBody.id}/option-groups`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Extras',
          required: false,
          minSelections: 0,
          maxSelections: 2,
        });
      expect(optionalGroup.status).toBe(201);

      const hidden = await request(server)
        .patch(`/api/v1/merchant/${merchantId}/products/${productBody.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ available: false });
      expect(hidden.status).toBe(200);
      expect((hidden.body as ProductBody).available).toBe(false);
      expect((hidden.body as ProductBody).id).toBe(productBody.id);

      const stillThere = await request(server)
        .get(`/api/v1/merchant/${merchantId}/products/${productBody.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(stillThere.status).toBe(200);
      expect((stillThere.body as ProductBody).available).toBe(false);

      const hideOption = await request(server)
        .patch(
          `/api/v1/merchant/${merchantId}/products/${productBody.id}/option-groups/${groupId}/options/${(option.body as OptionBody).id}`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ available: false });
      expect(hideOption.status).toBe(200);
      expect((hideOption.body as OptionBody).available).toBe(false);

      const me = await request(server)
        .get('/api/v1/merchant/me')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(me.status).toBe(200);
      expect(
        (me.body as MeBody).memberships.find(
          (row) => row.merchantId === merchantId,
        )?.operationalReady,
      ).toBe(false);

      const otherBranch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Second',
          phone: '0550123457',
          addressText: 'Street B',
          latitude: 36.76,
          longitude: 3.06,
        });
      expect(otherBranch.status).toBe(201);
      const otherBranchId = (otherBranch.body as BranchBody).id;
      const otherCategory = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ branchId: otherBranchId, name: 'Other' });
      expect(otherCategory.status).toBe(201);
      const mismatch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          branchId,
          categoryId: (otherCategory.body as CategoryBody).id,
          name: 'Mismatch',
          priceMinor: 100,
        });
      expect(mismatch.status).toBe(404);

      const catalog = await request(server)
        .get(`/api/v1/merchant/${merchantId}/catalog`)
        .query({ branchId })
        .set('Authorization', `Bearer ${tokenA}`);
      expect(catalog.status).toBe(200);
      expect(
        (catalog.body as { stats: { productCount: number } }).stats
          .productCount,
      ).toBe(3);

      const patchedProduct = await request(server)
        .patch(`/api/v1/merchant/${merchantId}/products/${productBody.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Espresso', priceMinor: 1299 });
      expect(patchedProduct.status).toBe(200);
      expect((patchedProduct.body as ProductBody).name).toBe('Espresso');

      const patchedOption = await request(server)
        .patch(
          `/api/v1/merchant/${merchantId}/products/${productBody.id}/option-groups/${groupId}/options/${(option.body as OptionBody).id}`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ additionalPriceMinor: 300 });
      expect(patchedOption.status).toBe(200);
      expect((patchedOption.body as OptionBody).additionalPriceMinor).toBe(300);

      const merchantB = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Other Cafe' });
      const merchantBId = (merchantB.body as MembershipBody).merchantId;
      const steal = await request(server)
        .patch(`/api/v1/merchant/${merchantBId}/products/${productBody.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Stolen' });
      expect(steal.status).toBe(404);
      const stealAsA = await request(server)
        .get(`/api/v1/merchant/${merchantId}/products/${productBody.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(stealAsA.status).toBe(404);

      await prisma.getDb().orm.public.MerchantMember.create({
        id: createUuidV7(),
        merchantId,
        accountId: accountStaff.id,
        role: pgVarchar<64>('STAFF'),
        createdAt: pgNow(),
      });
      const staffMutate = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({ branchId, name: 'Staff' });
      expect(staffMutate.status).toBe(403);
      const staffRead = await request(server)
        .get(`/api/v1/merchant/${merchantId}/categories`)
        .query({ branchId })
        .set('Authorization', `Bearer ${tokenStaff}`);
      expect(staffRead.status).toBe(200);

      await prisma
        .getDb()
        .orm.public.Merchant.where({ id: merchantId })
        .update({
          status: pgVarchar<64>('SUSPENDED'),
          updatedAt: pgNow(),
        });
      const suspended = await request(server)
        .patch(`/api/v1/merchant/${merchantId}/products/${productBody.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Locked' });
      expect(suspended.status).toBe(409);
      expect((suspended.body as ErrorBody).error.code).toBe(
        'MERCHANT_STATUS_RESTRICTED',
      );
    } finally {
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });
});
