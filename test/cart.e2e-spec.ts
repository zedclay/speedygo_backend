import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { isPostgresUniqueViolation } from '../src/common/errors/postgres-unique';
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
type CategoryBody = { id: string };
type ProductBody = { id: string; priceMinor: number };
type OptionGroupBody = { id: string };
type OptionBody = { id: string };
type CartBody = {
  id: string;
  branchId: string;
  cartReady: boolean;
  cartSubtotalMinor: number;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    baseUnitPriceMinor: number;
    optionUnitAdditionalMinor: number;
    unitPriceMinor: number;
    lineSubtotalMinor: number;
    storedUnitPriceMinor: number;
    itemAvailable: boolean;
    selectedOptions: Array<{
      optionId: string;
      name: string | null;
      additionalPriceMinor: number;
      available: boolean;
    }>;
  }>;
};
type CartBootstrap = { cartExists: boolean; cart: CartBody | null };

describe('Cart foundation (e2e)', () => {
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
        deviceName: 'cart-e2e',
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

  async function approveMerchant(merchantId: string): Promise<void> {
    const now = pgNow();
    await prisma
      .getDb()
      .orm.public.Merchant.where({ id: merchantId })
      .update({
        status: pgVarchar<64>('ACTIVE'),
        verifiedAt: now,
        updatedAt: now,
      });
  }

  async function optionRows(cartItemId: string) {
    return prisma.getDb().orm.public.CartItemOption.where({ cartItemId }).all();
  }

  async function cleanupByPhone(phoneE164: string) {
    const account = await prisma
      .getDb()
      .orm.public.Account.where({ phone: phoneE164 })
      .first();
    if (!account) {
      return;
    }
    const profile = await prisma
      .getDb()
      .orm.public.CustomerProfile.where({ accountId: account.id })
      .first();
    if (profile) {
      const carts = await prisma
        .getDb()
        .orm.public.Cart.where({ customerId: profile.id })
        .all();
      for (const cart of carts) {
        await prisma.getDb().orm.public.Cart.where({ id: cart.id }).delete();
      }
      const addresses = await prisma
        .getDb()
        .orm.public.Address.where({ customerId: profile.id })
        .all();
      for (const address of addresses) {
        await prisma
          .getDb()
          .orm.public.Address.where({ id: address.id })
          .delete();
      }
      await prisma
        .getDb()
        .orm.public.CustomerProfile.where({ id: profile.id })
        .delete();
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
        const cartsOnBranch = await prisma
          .getDb()
          .orm.public.Cart.where({ merchantBranchId: branch.id })
          .all();
        for (const cart of cartsOnBranch) {
          await prisma.getDb().orm.public.Cart.where({ id: cart.id }).delete();
        }
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
    await prisma.getDb().orm.public.Account.where({ id: account.id }).delete();
  }

  it('persists Cart options and manages Active Cart without Checkout or Orders', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      a: `0591${suffix}`,
      b: `0592${suffix}`,
      merchant: `0593${suffix}`,
    };
    const e164: string[] = [];
    try {
      const tokenA = await authenticate(phones.a);
      const tokenB = await authenticate(phones.b);
      const tokenMerchant = await authenticate(phones.merchant);
      e164.push(
        (await authMe(tokenA)).phone,
        (await authMe(tokenB)).phone,
        (await authMe(tokenMerchant)).phone,
      );

      const noProfile = await request(server)
        .get('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(noProfile.status).toBe(404);
      expect((noProfile.body as ErrorBody).error.code).toBe(
        'CUSTOMER_PROFILE_NOT_FOUND',
      );

      const profileA = await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: 'Cart Customer A' });
      expect(profileA.status).toBe(201);
      await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ fullName: 'Cart Customer B' });

      const empty = await request(server)
        .get('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(empty.status).toBe(200);
      expect((empty.body as CartBootstrap).cartExists).toBe(false);

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ name: 'Cart Cafe' });
      expect(merchant.status).toBe(201);
      const merchantId = (merchant.body as MembershipBody).merchantId;
      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'Main',
          phone: '0550123456',
          addressText: 'Street A',
          latitude: 36.75,
          longitude: 3.05,
        });
      expect(branch.status).toBe(201);
      const branchId = (branch.body as BranchBody).id;
      const branch2 = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'Second',
          phone: '0550123457',
          addressText: 'Street B',
          latitude: 36.76,
          longitude: 3.06,
        });
      expect(branch2.status).toBe(201);
      const branch2Id = (branch2.body as BranchBody).id;
      await approveMerchant(merchantId);

      const category = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ branchId, name: 'Drinks' });
      expect(category.status).toBe(201);
      const categoryId = (category.body as CategoryBody).id;
      const category2 = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ branchId: branch2Id, name: 'Other' });
      expect(category2.status).toBe(201);
      const category2Id = (category2.body as CategoryBody).id;

      const plain = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          branchId,
          categoryId,
          name: 'Water',
          priceMinor: 100,
        });
      expect(plain.status).toBe(201);
      const plainId = (plain.body as ProductBody).id;

      const product = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          branchId,
          categoryId,
          name: 'Coffee',
          priceMinor: 1000,
        });
      expect(product.status).toBe(201);
      const productId = (product.body as ProductBody).id;

      const otherProduct = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          branchId: branch2Id,
          categoryId: category2Id,
          name: 'Tea',
          priceMinor: 800,
        });
      expect(otherProduct.status).toBe(201);
      const otherProductId = (otherProduct.body as ProductBody).id;

      const group = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'Size',
          required: true,
          minSelections: 1,
          maxSelections: 1,
        });
      expect(group.status).toBe(201);
      const groupId = (group.body as OptionGroupBody).id;
      const extras = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'Extras',
          required: false,
          minSelections: 0,
          maxSelections: 2,
        });
      expect(extras.status).toBe(201);
      const extrasId = (extras.body as OptionGroupBody).id;
      const large = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups/${groupId}/options`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ name: 'Large', additionalPriceMinor: 200 });
      expect(large.status).toBe(201);
      const largeId = (large.body as OptionBody).id;
      const small = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups/${groupId}/options`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ name: 'Small', additionalPriceMinor: 0 });
      expect(small.status).toBe(201);
      const smallId = (small.body as OptionBody).id;
      const milk = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productId}/option-groups/${extrasId}/options`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ name: 'Milk', additionalPriceMinor: 50 });
      expect(milk.status).toBe(201);
      const milkId = (milk.body as OptionBody).id;

      const zeroOpts = await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: plainId, quantity: 1 });
      expect(zeroOpts.status).toBe(200);
      const zeroBody = zeroOpts.body as CartBody;
      expect(zeroBody.cartReady).toBe(true);
      expect(zeroBody.items[0]?.selectedOptions).toEqual([]);
      expect(await optionRows(zeroBody.items[0]?.id)).toHaveLength(0);
      const clearedPlain = await request(server)
        .delete('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect((clearedPlain.body as CartBootstrap).cartExists).toBe(false);

      const missingRequired = await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId, quantity: 1 });
      expect(missingRequired.status).toBe(400);
      expect((missingRequired.body as ErrorBody).error.code).toBe(
        'CART_REQUIRED_OPTION_MISSING',
      );

      const added = await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId, quantity: 1, optionIds: [largeId] });
      expect(added.status).toBe(200);
      const addedBody = added.body as CartBody;
      expect(addedBody.cartReady).toBe(true);
      expect(addedBody.cartSubtotalMinor).toBe(1200);
      expect(addedBody.items[0]?.optionUnitAdditionalMinor).toBe(200);
      expect(addedBody.items[0]?.unitPriceMinor).toBe(1200);
      expect(addedBody.items[0]?.storedUnitPriceMinor).toBe(1200);
      expect(
        addedBody.items[0]?.selectedOptions.map((row) => row.optionId),
      ).toEqual([largeId]);
      const itemId = addedBody.items[0]?.id;
      expect(await optionRows(itemId)).toHaveLength(1);
      try {
        await prisma.getDb().orm.public.CartItemOption.create({
          id: createUuidV7(),
          cartItemId: itemId,
          productOptionId: largeId,
          createdAt: pgNow(),
        });
        throw new Error('expected unique violation');
      } catch (error) {
        expect(isPostgresUniqueViolation(error)).toBe(true);
      }

      const got = await request(server)
        .get('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(got.status).toBe(200);
      expect((got.body as CartBootstrap).cart?.cartReady).toBe(true);
      expect(
        (got.body as CartBootstrap).cart?.items[0]?.selectedOptions[0]
          ?.optionId,
      ).toBe(largeId);

      const patchedQty = await request(server)
        .patch(`/api/v1/customer/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ quantity: 2 });
      expect(patchedQty.status).toBe(200);
      expect((patchedQty.body as CartBody).items[0]?.quantity).toBe(2);
      expect(
        (patchedQty.body as CartBody).items[0]?.selectedOptions,
      ).toHaveLength(1);

      const patchedOpts = await request(server)
        .patch(`/api/v1/customer/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ quantity: 2, optionIds: [smallId] });
      expect(patchedOpts.status).toBe(200);
      expect(
        (patchedOpts.body as CartBody).items[0]?.selectedOptions[0]?.optionId,
      ).toBe(smallId);

      const invalidReplace = await request(server)
        .patch(`/api/v1/customer/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ quantity: 2, optionIds: [] });
      expect(invalidReplace.status).toBe(400);
      expect((invalidReplace.body as ErrorBody).error.code).toBe(
        'CART_REQUIRED_OPTION_MISSING',
      );
      const afterInvalid = await request(server)
        .get('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(
        (afterInvalid.body as CartBootstrap).cart?.items[0]?.selectedOptions[0]
          ?.optionId,
      ).toBe(smallId);

      await request(server)
        .patch(`/api/v1/customer/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ quantity: 1, optionIds: [largeId] });

      const merged = await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId, quantity: 1, optionIds: [largeId] });
      expect(merged.status).toBe(200);
      expect((merged.body as CartBody).items).toHaveLength(1);
      expect((merged.body as CartBody).items[0]?.quantity).toBe(2);

      const ordered = await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId, quantity: 1, optionIds: [milkId, largeId] });
      expect(ordered.status).toBe(200);
      expect((ordered.body as CartBody).items).toHaveLength(2);
      const reverse = await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId, quantity: 1, optionIds: [largeId, milkId] });
      expect((reverse.body as CartBody).items).toHaveLength(2);
      const milkLine = (reverse.body as CartBody).items.find(
        (item) => item.selectedOptions.length === 2,
      );
      expect(milkLine?.quantity).toBe(2);
      expect(milkLine?.optionUnitAdditionalMinor).toBe(250);
      expect(milkLine?.lineSubtotalMinor).toBe(2500);

      const split = await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId, quantity: 1, optionIds: [smallId] });
      expect((split.body as CartBody).items).toHaveLength(3);

      const otherBranch = await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: otherProductId, quantity: 1 });
      expect(otherBranch.status).toBe(409);
      expect((otherBranch.body as ErrorBody).error.code).toBe(
        'CART_BRANCH_MISMATCH',
      );

      const steal = await request(server)
        .patch(`/api/v1/customer/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ quantity: 1 });
      expect(steal.status).toBe(404);

      await prisma
        .getDb()
        .orm.public.ProductOption.where({ id: largeId })
        .update({ available: false, updatedAt: pgNow() });
      const stale = await request(server)
        .get('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(stale.status).toBe(200);
      const staleCart = (stale.body as CartBootstrap).cart;
      expect(staleCart?.items.length).toBeGreaterThan(0);
      expect(staleCart?.cartReady).toBe(false);

      const cartItemBeforeDelete = await prisma
        .getDb()
        .orm.public.CartItem.where({ id: itemId })
        .first();
      expect(cartItemBeforeDelete).not.toBeNull();
      await prisma
        .getDb()
        .orm.public.ProductOption.where({ id: largeId })
        .delete();
      const cartItemAfterOptionDelete = await prisma
        .getDb()
        .orm.public.CartItem.where({ id: itemId })
        .first();
      expect(cartItemAfterOptionDelete).not.toBeNull();
      expect(await optionRows(itemId)).toHaveLength(0);
      const afterDelete = await request(server)
        .get('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect((afterDelete.body as CartBootstrap).cart?.cartReady).toBe(false);
      expect(
        (afterDelete.body as CartBootstrap).cart?.items.length,
      ).toBeGreaterThan(0);

      const remaining = (afterDelete.body as CartBootstrap).cart?.items ?? [];
      for (const item of remaining) {
        const removed = await request(server)
          .delete(`/api/v1/customer/cart/items/${item.id}`)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(removed.status).toBe(200);
      }
      const gone = await request(server)
        .get('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect((gone.body as CartBootstrap).cartExists).toBe(false);

      const [firstConcurrent, secondConcurrent] = await Promise.all([
        request(server)
          .post('/api/v1/customer/cart/items')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ productId: otherProductId, quantity: 1 }),
        request(server)
          .post('/api/v1/customer/cart/items')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ productId: otherProductId, quantity: 1 }),
      ]);
      expect(firstConcurrent.status).toBe(200);
      expect(secondConcurrent.status).toBe(200);
      const afterConcurrent = await request(server)
        .get('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(afterConcurrent.status).toBe(200);
      const concurrentCart = (afterConcurrent.body as CartBootstrap).cart;
      expect(concurrentCart?.branchId).toBe(branch2Id);
      expect(concurrentCart?.items).toHaveLength(1);
      expect(concurrentCart?.items[0]?.quantity).toBe(2);

      const lastItemId = concurrentCart?.items[0]?.id as string;
      const lastRemoved = await request(server)
        .delete(`/api/v1/customer/cart/items/${lastItemId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(lastRemoved.status).toBe(200);
      expect((lastRemoved.body as CartBootstrap).cartExists).toBe(false);
      expect(await optionRows(lastItemId)).toHaveLength(0);
    } finally {
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });
});
