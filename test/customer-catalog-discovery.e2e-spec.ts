import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MONEY_MINOR_ABOVE_SAFE_INTEGER } from '../src/common/money/money-minor';
import { createUuidV7 } from '../src/common/utils/uuid-v7';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { PrismaService } from '../src/infrastructure/database/database.module';
import {
  pgBigInt,
  pgNow,
  pgTimestamptz,
  pgVarchar,
} from '../src/infrastructure/database/pg-values';
import { OTP_SENDER } from '../src/modules/auth/domain/ports/otp-sender.port';
import { TestOtpSender } from '../src/modules/auth/infrastructure/otp/test-otp.sender';
import { deactivateAllDeliveryZones } from './helpers/sanitize-delivery-zones';
import { deleteAccountNotificationArtifacts } from './helpers/delete-account-notifications';

type TokenBody = { accessToken: string };
type ErrorBody = { error: { code: string; message: string } };
type AuthMeBody = { account: { id: string; phone: string } };
type MembershipBody = { merchantId: string };
type BranchBody = { id: string };
type CategoryBody = { id: string };
type ProductBody = { id: string; priceMinor: string };
type AddressBody = { id: string };
type StorefrontList = {
  items: Array<{
    branchId: string;
    branchName: string;
    merchantId: string;
    merchantName: string;
    addressText: string;
    latitude: number;
    longitude: number;
    merchantPublicReference: string;
  }>;
  limit: number;
  offset: number;
  total: number;
};
type ProductList = {
  items: Array<{
    productId: string;
    name: string;
    priceMinor: string;
    branchId: string;
  }>;
  limit: number;
  offset: number;
  total: number;
};
type SearchBody = {
  items: Array<
    | {
        type: 'STOREFRONT';
        storefront: { branchId: string; branchName: string };
      }
    | {
        type: 'PRODUCT';
        product: { productId: string; name: string; priceMinor: string };
      }
  >;
  total: number;
  limit: number;
  offset: number;
};
type CartBody = {
  cartReady: boolean;
  cartSubtotalMinor: string;
  items: Array<{ productId: string; unitPriceMinor: string }>;
};
type PreviewBody = {
  checkoutReady: boolean;
  merchandiseSubtotalMinor: string;
  deliveryFeeMinor: string;
  customerTotalMinor: string;
};

const COVERING_RING: Array<[number, number]> = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];

describe('Customer catalog discovery (e2e)', () => {
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
    await deactivateAllDeliveryZones(prisma);
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
        deviceName: 'customer-catalog-e2e',
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

  async function setMerchantStatus(
    merchantId: string,
    status: string,
    verifiedAt: string | null,
  ): Promise<void> {
    await prisma
      .getDb()
      .orm.public.Merchant.where({ id: merchantId })
      .update({
        status: pgVarchar<64>(status),
        verifiedAt: verifiedAt === null ? null : pgTimestamptz(verifiedAt),
        updatedAt: pgNow(),
      });
  }

  async function setBranchStatus(
    branchId: string,
    operationalStatus: string,
  ): Promise<void> {
    await prisma
      .getDb()
      .orm.public.MerchantBranch.where({ id: branchId })
      .update({
        operationalStatus: pgVarchar<64>(operationalStatus),
        updatedAt: pgNow(),
      });
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
    await deleteAccountNotificationArtifacts(prisma, account.id);
    await prisma.getDb().orm.public.Account.where({ id: account.id }).delete();
  }

  it('covers discovery endpoints, visibility, search, money, and cart/checkout', async () => {
    const server = app.getHttpServer();
    const suffix = Date.now().toString().slice(-6);
    const phones = {
      customer: `0581${suffix}`,
      merchant: `0582${suffix}`,
      merchantB: `0583${suffix}`,
      noProfile: `0584${suffix}`,
    };
    const e164: string[] = [];
    const zoneIds: string[] = [];

    try {
      const tokenCustomer = await authenticate(phones.customer);
      const tokenMerchant = await authenticate(phones.merchant);
      const tokenMerchantB = await authenticate(phones.merchantB);
      const tokenNoProfile = await authenticate(phones.noProfile);
      e164.push(
        (await authMe(tokenCustomer)).phone,
        (await authMe(tokenMerchant)).phone,
        (await authMe(tokenMerchantB)).phone,
        (await authMe(tokenNoProfile)).phone,
      );

      const unauthorized = await request(server).get(
        '/api/v1/customer/branches',
      );
      expect(unauthorized.status).toBe(401);

      const noProfile = await request(server)
        .get('/api/v1/customer/branches')
        .set('Authorization', `Bearer ${tokenNoProfile}`);
      expect(noProfile.status).toBe(404);
      expect((noProfile.body as ErrorBody).error.code).toBe(
        'CUSTOMER_PROFILE_NOT_FOUND',
      );

      const profile = await request(server)
        .post('/api/v1/customer/profile')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ fullName: 'Discovery Customer' });
      expect(profile.status).toBe(201);

      const address = await request(server)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          label: 'Home',
          addressText: 'Algiers',
          latitude: 36.75,
          longitude: 3.05,
        });
      expect(address.status).toBe(201);
      const addressId = (address.body as AddressBody).id;

      const merchant = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ name: 'Alpha Discovery Cafe' });
      expect(merchant.status).toBe(201);
      const merchantId = (merchant.body as MembershipBody).merchantId;

      const branch = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'Alpha Main Branch',
          phone: '0550111222',
          addressText: 'Rue Discovery 1',
          latitude: 36.75,
          longitude: 3.05,
        });
      expect(branch.status).toBe(201);
      const branchId = (branch.body as BranchBody).id;

      const branch2 = await request(server)
        .post(`/api/v1/merchant/${merchantId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'Alpha Inactive Branch',
          phone: '0550111223',
          addressText: 'Rue Discovery 2',
          latitude: 36.76,
          longitude: 3.06,
        });
      expect(branch2.status).toBe(201);
      const inactiveBranchId = (branch2.body as BranchBody).id;
      await setBranchStatus(inactiveBranchId, 'INACTIVE');

      const merchantB = await request(server)
        .post('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenMerchantB}`)
        .send({ name: 'Beta Other Merchant' });
      expect(merchantB.status).toBe(201);
      const merchantBId = (merchantB.body as MembershipBody).merchantId;
      const branchB = await request(server)
        .post(`/api/v1/merchant/${merchantBId}/branches`)
        .set('Authorization', `Bearer ${tokenMerchantB}`)
        .send({
          name: 'Beta Branch',
          phone: '0550333444',
          addressText: 'Rue Beta',
          latitude: 36.77,
          longitude: 3.07,
        });
      expect(branchB.status).toBe(201);
      const branchBId = (branchB.body as BranchBody).id;
      await approveMerchant(merchantBId);

      const categoryB = await request(server)
        .post(`/api/v1/merchant/${merchantBId}/categories`)
        .set('Authorization', `Bearer ${tokenMerchantB}`)
        .send({ branchId: branchBId, name: 'Beta Drinks' });
      expect(categoryB.status).toBe(201);
      const categoryBId = (categoryB.body as CategoryBody).id;
      const productB = await request(server)
        .post(`/api/v1/merchant/${merchantBId}/products`)
        .set('Authorization', `Bearer ${tokenMerchantB}`)
        .send({
          branchId: branchBId,
          categoryId: categoryBId,
          name: 'Beta Tea',
          priceMinor: 500,
        });
      expect(productB.status).toBe(201);
      const productBId = (productB.body as ProductBody).id;

      // Pending merchant must not appear
      let listed = await request(server)
        .get('/api/v1/customer/branches')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(listed.status).toBe(200);
      expect(
        (listed.body as StorefrontList).items.some(
          (item) => item.branchId === branchId,
        ),
      ).toBe(false);

      await approveMerchant(merchantId);

      const category = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ branchId, name: 'Drinks' });
      expect(category.status).toBe(201);
      const categoryId = (category.body as CategoryBody).id;

      const emptyCategory = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ branchId, name: 'Empty Shelf' });
      expect(emptyCategory.status).toBe(201);

      const inactiveCategory = await request(server)
        .post(`/api/v1/merchant/${merchantId}/categories`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ branchId, name: 'Hidden Category', active: false });
      expect(inactiveCategory.status).toBe(201);
      const inactiveCategoryId = (inactiveCategory.body as CategoryBody).id;

      const product = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          branchId,
          categoryId,
          name: 'Discovery Coffee',
          description: 'Hot coffee',
          priceMinor: 1200,
        });
      expect(product.status).toBe(201);
      const productIdFromCreate = (product.body as ProductBody).id;

      const optionGroup = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productIdFromCreate}/option-groups`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          name: 'Size',
          required: false,
          minSelections: 0,
          maxSelections: 1,
        });
      expect(optionGroup.status).toBe(201);
      const optionGroupId = (optionGroup.body as { id: string }).id;
      const largeOption = await request(server)
        .post(
          `/api/v1/merchant/${merchantId}/products/${productIdFromCreate}/option-groups/${optionGroupId}/options`,
        )
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({ name: 'Large', additionalPriceMinor: 250 });
      expect(largeOption.status).toBe(201);
      const largeOptionId = (largeOption.body as { id: string }).id;

      const unavailable = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          branchId,
          categoryId,
          name: 'Unavailable Latte',
          priceMinor: 1500,
          available: false,
        });
      expect(unavailable.status).toBe(201);
      const unavailableId = (unavailable.body as ProductBody).id;

      const hiddenInInactiveCategory = await request(server)
        .post(`/api/v1/merchant/${merchantId}/products`)
        .set('Authorization', `Bearer ${tokenMerchant}`)
        .send({
          branchId,
          categoryId: inactiveCategoryId,
          name: 'Ghost Product',
          priceMinor: 100,
        });
      expect(hiddenInInactiveCategory.status).toBe(201);
      const ghostId = (hiddenInInactiveCategory.body as ProductBody).id;

      // --- list storefronts happy + contract ---
      listed = await request(server)
        .get('/api/v1/customer/branches?limit=50&offset=0')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(listed.status).toBe(200);
      const storefronts = listed.body as StorefrontList;
      expect(storefronts.limit).toBe(50);
      expect(storefronts.offset).toBe(0);
      const alpha = storefronts.items.find(
        (item) => item.branchId === branchId,
      );
      expect(alpha).toBeDefined();
      expect(alpha!.branchName).toBe('Alpha Main Branch');
      expect(alpha!.merchantName).toBe('Alpha Discovery Cafe');
      expect(alpha!.addressText).toBe('Rue Discovery 1');
      expect(alpha).not.toHaveProperty('phone');
      expect(alpha).not.toHaveProperty('status');
      expect(alpha).not.toHaveProperty('verifiedAt');
      expect(alpha).not.toHaveProperty('openNow');
      expect(alpha).not.toHaveProperty('distance');
      expect(alpha).not.toHaveProperty('deliveryFeeMinor');
      expect(
        storefronts.items.some((item) => item.branchId === inactiveBranchId),
      ).toBe(false);

      const invalidPage = await request(server)
        .get('/api/v1/customer/branches?limit=0')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(invalidPage.status).toBe(400);

      // --- storefront detail ---
      const detail = await request(server)
        .get(`/api/v1/customer/branches/${branchId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(detail.status).toBe(200);
      expect(detail.body).not.toHaveProperty('phone');

      const inactiveDetail = await request(server)
        .get(`/api/v1/customer/branches/${inactiveBranchId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(inactiveDetail.status).toBe(404);
      expect((inactiveDetail.body as ErrorBody).error.code).toBe(
        'CUSTOMER_STOREFRONT_NOT_FOUND',
      );

      // --- categories ---
      const categories = await request(server)
        .get(`/api/v1/customer/branches/${branchId}/categories`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(categories.status).toBe(200);
      const categoryNames = (
        categories.body as { items: Array<{ name: string }> }
      ).items.map((item) => item.name);
      expect(categoryNames).toContain('Drinks');
      expect(categoryNames).not.toContain('Empty Shelf');
      expect(categoryNames).not.toContain('Hidden Category');

      // --- products ---
      const products = await request(server)
        .get(`/api/v1/customer/branches/${branchId}/products`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(products.status).toBe(200);
      const productPage = products.body as ProductList;
      expect(
        productPage.items.some((item) => item.productId === unavailableId),
      ).toBe(false);
      expect(productPage.items.some((item) => item.productId === ghostId)).toBe(
        false,
      );
      expect(
        productPage.items.some((item) => item.productId === productBId),
      ).toBe(false);
      const discovered = productPage.items.find(
        (item) => item.name === 'Discovery Coffee',
      );
      expect(discovered).toBeDefined();
      expect(discovered!.productId).toBe(productIdFromCreate);
      expect(discovered!.priceMinor).toBe('1200');
      expect(typeof discovered!.priceMinor).toBe('string');

      const filtered = await request(server)
        .get(
          `/api/v1/customer/branches/${branchId}/products?categoryId=${categoryId}`,
        )
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(filtered.status).toBe(200);
      expect((filtered.body as ProductList).total).toBeGreaterThanOrEqual(1);

      // --- product detail ---
      const productDetail = await request(server)
        .get(
          `/api/v1/customer/branches/${branchId}/products/${discovered!.productId}`,
        )
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(productDetail.status).toBe(200);
      expect((productDetail.body as { productId: string }).productId).toBe(
        discovered!.productId,
      );
      expect(
        typeof (productDetail.body as { priceMinor: string }).priceMinor,
      ).toBe('string');
      expect((productDetail.body as { priceMinor: string }).priceMinor).toBe(
        '1200',
      );
      const optionMoney = (
        productDetail.body as {
          optionGroups: Array<{
            options: Array<{
              optionId: string;
              additionalPriceMinor: string;
            }>;
          }>;
        }
      ).optionGroups
        .flatMap((group) => group.options)
        .find((option) => option.optionId === largeOptionId);
      expect(optionMoney).toBeDefined();
      expect(typeof optionMoney!.additionalPriceMinor).toBe('string');
      expect(optionMoney!.additionalPriceMinor).toBe('250');

      const crossMerchant = await request(server)
        .get(`/api/v1/customer/branches/${branchId}/products/${productBId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(crossMerchant.status).toBe(404);
      expect((crossMerchant.body as ErrorBody).error.code).toBe(
        'CUSTOMER_PRODUCT_NOT_FOUND',
      );

      const hiddenDetail = await request(server)
        .get(`/api/v1/customer/branches/${branchId}/products/${unavailableId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(hiddenDetail.status).toBe(404);

      // --- money above safe integer via direct DB write ---
      await prisma
        .getDb()
        .orm.public.Product.where({ id: discovered!.productId })
        .update({
          priceMinor: BigInt(MONEY_MINOR_ABOVE_SAFE_INTEGER),
          updatedAt: pgNow(),
        });
      await prisma
        .getDb()
        .orm.public.ProductOption.where({ id: largeOptionId })
        .update({
          additionalPriceMinor: BigInt(MONEY_MINOR_ABOVE_SAFE_INTEGER),
          updatedAt: pgNow(),
        });
      const moneyDetail = await request(server)
        .get(
          `/api/v1/customer/branches/${branchId}/products/${discovered!.productId}`,
        )
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(moneyDetail.status).toBe(200);
      expect((moneyDetail.body as { priceMinor: string }).priceMinor).toBe(
        MONEY_MINOR_ABOVE_SAFE_INTEGER,
      );
      expect(
        typeof (moneyDetail.body as { priceMinor: string }).priceMinor,
      ).toBe('string');
      const optionAboveSafe = (
        moneyDetail.body as {
          optionGroups: Array<{
            options: Array<{
              optionId: string;
              additionalPriceMinor: string;
            }>;
          }>;
        }
      ).optionGroups
        .flatMap((group) => group.options)
        .find((option) => option.optionId === largeOptionId);
      expect(optionAboveSafe).toBeDefined();
      expect(typeof optionAboveSafe!.additionalPriceMinor).toBe('string');
      expect(optionAboveSafe!.additionalPriceMinor).toBe(
        MONEY_MINOR_ABOVE_SAFE_INTEGER,
      );
      // restore cart-safe prices within catalog write bounds
      await prisma
        .getDb()
        .orm.public.Product.where({ id: discovered!.productId })
        .update({
          priceMinor: BigInt(1200),
          updatedAt: pgNow(),
        });
      await prisma
        .getDb()
        .orm.public.ProductOption.where({ id: largeOptionId })
        .update({
          additionalPriceMinor: BigInt(250),
          updatedAt: pgNow(),
        });

      // --- search ---
      const searchShort = await request(server)
        .get('/api/v1/customer/catalog/search?q=a')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchShort.status).toBe(400);

      const searchWildcardOnly = await request(server)
        .get('/api/v1/customer/catalog/search?q=%25%25')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchWildcardOnly.status).toBe(400);
      expect((searchWildcardOnly.body as ErrorBody).error.code).toBe(
        'CUSTOMER_SEARCH_QUERY_INVALID',
      );

      const searchWildcardSpaces = await request(server)
        .get('/api/v1/customer/catalog/search?q=%20%25%20_%20')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchWildcardSpaces.status).toBe(400);

      const searchNormalizedOneChar = await request(server)
        .get('/api/v1/customer/catalog/search?q=a%25%25')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchNormalizedOneChar.status).toBe(400);

      const searchUnderscoreOnly = await request(server)
        .get('/api/v1/customer/catalog/search?q=__')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchUnderscoreOnly.status).toBe(400);

      const searchLong = await request(server)
        .get(`/api/v1/customer/catalog/search?q=${'x'.repeat(101)}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchLong.status).toBe(400);

      const searchStorefront = await request(server)
        .get('/api/v1/customer/catalog/search?q=alpha%20main')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchStorefront.status).toBe(200);
      const storefrontHits = searchStorefront.body as SearchBody;
      expect(
        storefrontHits.items.some(
          (hit) =>
            hit.type === 'STOREFRONT' && hit.storefront.branchId === branchId,
        ),
      ).toBe(true);

      // Stripped wildcards around a valid term must not become unbounded match-all
      const searchWithEmbeddedWildcards = await request(server)
        .get('/api/v1/customer/catalog/search?q=Coffee%25%25')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchWithEmbeddedWildcards.status).toBe(200);
      const embeddedHits = searchWithEmbeddedWildcards.body as SearchBody;
      expect(embeddedHits.total).toBeGreaterThan(0);
      expect(embeddedHits.limit).toBeLessThanOrEqual(100);
      expect(embeddedHits.items.length).toBeLessThanOrEqual(embeddedHits.limit);
      expect(
        embeddedHits.items.every((hit) => {
          if (hit.type === 'PRODUCT') {
            return hit.product.name.toLowerCase().includes('coffee');
          }
          if (hit.type === 'STOREFRONT') {
            return (
              hit.storefront.branchName.toLowerCase().includes('coffee') ||
              // merchant name is also searched for STOREFRONT hits
              true
            );
          }
          return false;
        }),
      ).toBe(true);
      expect(
        embeddedHits.items.some(
          (hit) =>
            hit.type === 'PRODUCT' && hit.product.productId === unavailableId,
        ),
      ).toBe(false);
      // Must include the discovered coffee product; must not dump unrelated Beta Tea alone as match-all
      expect(
        embeddedHits.items.some(
          (hit) =>
            hit.type === 'PRODUCT' &&
            hit.product.productId === discovered!.productId,
        ),
      ).toBe(true);
      expect(
        embeddedHits.items.every((hit) => {
          if (hit.type !== 'PRODUCT') {
            return true;
          }
          return hit.product.name.toLowerCase().includes('coffee');
        }),
      ).toBe(true);

      const searchProduct = await request(server)
        .get('/api/v1/customer/catalog/search?q=discovery%20coffee')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchProduct.status).toBe(200);
      const productHits = searchProduct.body as SearchBody;
      expect(
        productHits.items.some(
          (hit) =>
            hit.type === 'PRODUCT' &&
            hit.product.productId === discovered!.productId &&
            typeof hit.product.priceMinor === 'string',
        ),
      ).toBe(true);
      expect(
        productHits.items.some(
          (hit) =>
            hit.type === 'PRODUCT' && hit.product.productId === unavailableId,
        ),
      ).toBe(false);

      const searchCase = await request(server)
        .get('/api/v1/customer/catalog/search?q=ALPHA%20DISCOVERY')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchCase.status).toBe(200);
      expect((searchCase.body as SearchBody).total).toBeGreaterThan(0);

      const searchEmpty = await request(server)
        .get('/api/v1/customer/catalog/search?q=zzznomatch999')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchEmpty.status).toBe(200);
      expect((searchEmpty.body as SearchBody).items).toEqual([]);
      expect((searchEmpty.body as SearchBody).total).toBe(0);

      const searchPage = await request(server)
        .get('/api/v1/customer/catalog/search?q=alpha&limit=1&offset=0')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(searchPage.status).toBe(200);
      expect((searchPage.body as SearchBody).items.length).toBeLessThanOrEqual(
        1,
      );
      expect((searchPage.body as SearchBody).limit).toBe(1);

      // --- visibility state matrix ---
      await setMerchantStatus(merchantId, 'PENDING_REVIEW', null);
      let hidden = await request(server)
        .get(`/api/v1/customer/branches/${branchId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(hidden.status).toBe(404);

      await setMerchantStatus(merchantId, 'REJECTED', null);
      hidden = await request(server)
        .get(`/api/v1/customer/branches/${branchId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(hidden.status).toBe(404);

      await approveMerchant(merchantId);
      await setMerchantStatus(
        merchantId,
        'SUSPENDED',
        '2026-01-01T00:00:00.000Z',
      );
      hidden = await request(server)
        .get(`/api/v1/customer/branches/${branchId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(hidden.status).toBe(404);

      await approveMerchant(merchantId);
      await setBranchStatus(branchId, 'INACTIVE');
      hidden = await request(server)
        .get(`/api/v1/customer/branches/${branchId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(hidden.status).toBe(404);
      await setBranchStatus(branchId, 'ACTIVE');

      // resource becoming inactive disappears
      listed = await request(server)
        .get('/api/v1/customer/branches')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(
        (listed.body as StorefrontList).items.some(
          (item) => item.branchId === branchId,
        ),
      ).toBe(true);
      await setBranchStatus(branchId, 'SUSPENDED');
      listed = await request(server)
        .get('/api/v1/customer/branches')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(
        (listed.body as StorefrontList).items.some(
          (item) => item.branchId === branchId,
        ),
      ).toBe(false);
      await setBranchStatus(branchId, 'ACTIVE');

      // --- discovery → cart → checkout (productId from discovery only) ---
      const rediscover = await request(server)
        .get(`/api/v1/customer/branches/${branchId}/products`)
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(rediscover.status).toBe(200);
      const cartProductId = (rediscover.body as ProductList).items.find(
        (item) => item.name === 'Discovery Coffee',
      )!.productId;

      const added = await request(server)
        .post('/api/v1/customer/cart/items')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ productId: cartProductId, quantity: 1 });
      expect(added.status).toBe(200);
      expect((added.body as CartBody).items[0].productId).toBe(cartProductId);
      expect(typeof (added.body as CartBody).cartSubtotalMinor).toBe('string');

      const cartRead = await request(server)
        .get('/api/v1/customer/cart')
        .set('Authorization', `Bearer ${tokenCustomer}`);
      expect(cartRead.status).toBe(200);
      expect(
        (
          cartRead.body as {
            cart: CartBody;
          }
        ).cart.items[0].productId,
      ).toBe(cartProductId);

      const now = pgNow();
      const zoneId = createUuidV7();
      await prisma.getDb().orm.public.DeliveryZone.create({
        id: zoneId,
        name: pgVarchar<255>(`Discovery zone ${suffix}`),
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[COVERING_RING]],
          srid: 4326,
        },
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      zoneIds.push(zoneId);
      await prisma.getDb().orm.public.DeliveryPricingRule.create({
        id: createUuidV7(),
        zoneId,
        name: pgVarchar<255>('All day'),
        timeBand: 'DAY',
        startLocalTime: null,
        endLocalTime: null,
        customerDeliveryFeeMinor: pgBigInt(400),
        driverRemunerationMinor: pgBigInt(200),
        effectiveFrom: pgTimestamptz('2020-01-01T00:00:00.000Z'),
        effectiveTo: null,
        active: true,
        createdAt: now,
        updatedAt: now,
      });

      const preview = await request(server)
        .post('/api/v1/customer/checkout/preview')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ addressId });
      expect(preview.status).toBe(200);
      const ready = preview.body as PreviewBody;
      expect(ready.checkoutReady).toBe(true);
      expect(typeof ready.merchandiseSubtotalMinor).toBe('string');
      expect(typeof ready.deliveryFeeMinor).toBe('string');
      expect(typeof ready.customerTotalMinor).toBe('string');
    } finally {
      for (const zoneId of zoneIds) {
        const rules = await prisma
          .getDb()
          .orm.public.DeliveryPricingRule.where({ zoneId })
          .all();
        for (const rule of rules) {
          await prisma
            .getDb()
            .orm.public.DeliveryPricingRule.where({ id: rule.id })
            .delete();
        }
        await prisma
          .getDb()
          .orm.public.DeliveryZone.where({ id: zoneId })
          .delete();
      }
      for (const phone of e164) {
        await cleanupByPhone(phone);
      }
    }
  });
});
