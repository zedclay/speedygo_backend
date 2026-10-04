#!/usr/bin/env node
/** Customer API verification with the synthetic reviewer. Does not touch the Simulator session. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXISTING_VERTICALS, REVIEWER_PHONE, VERTICAL_BAKERIES_ID, branchId, productId } from './ids.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'verification');
const API = process.env.SPEEDYGO_FIXTURE_API || 'http://127.0.0.1:3000/api/v1';

async function json(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, contentType: response.headers.get('content-type') };
}

async function login() {
  const req = await fetch(`${API}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'PHONE',
      identifier: REVIEWER_PHONE,
      purpose: 'AUTHENTICATE',
    }),
  });
  if (!req.ok) {
    throw new Error(`Reviewer OTP request ${req.status} ${await req.text()}`);
  }
  const { readFileSync } = await import('node:fs');
  await new Promise((r) => setTimeout(r, 200));
  const { homedir } = await import('node:os');
  const otpDir = process.env.SPEEDYGO_DEV_OTP_DIR?.trim() || join(homedir(), '.speedygo', 'dev');
  const code = readFileSync(join(otpDir, 'otp-last'), 'utf8').trim().split(/\s+/).pop();
  const verify = await fetch(`${API}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'PHONE',
      identifier: REVIEWER_PHONE,
      purpose: 'AUTHENTICATE',
      code,
      platform: 'web',
      appVersion: '0.0.0-review-verify',
      deviceName: 'review-catalog-verify',
    }),
  });
  const body = await verify.json();
  if (!verify.ok) {
    throw new Error(`Reviewer OTP verify ${verify.status} ${JSON.stringify(body)}`);
  }
  return body.accessToken;
}

function money(value) {
  return String(value);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const token = await login();
  const report = { actor: REVIEWER_PHONE, checks: [] };

  const verticals = await json(`${API}/customer/commerce-verticals`, token);
  report.verticals = {
    status: verticals.status,
    slugs: (verticals.body?.items || []).map((v) => `${v.slug}:${v.iconKey}`),
    count: verticals.body?.items?.length ?? 0,
  };
  report.checks.push({
    name: 'five_commerce_verticals',
    pass:
      verticals.status === 200 &&
      verticals.body.items.length === 5 &&
      verticals.body.items.some((v) => v.slug === 'review-bakeries') &&
      verticals.body.items.some((v) => v.slug === 'review-pharmacies'),
  });

  const branches = await json(`${API}/customer/branches?limit=50&offset=0`, token);
  const names = (branches.body?.items || []).map((b) => b.branchName);
  report.storefronts = {
    status: branches.status,
    total: branches.body?.total,
    limit: branches.body?.limit,
    names,
    paginationNote:
      'total < default limit 50; this dataset does not exercise a full live page. Keep catalog_pagination_test.dart.',
  };
  report.checks.push({
    name: 'storefront_list_includes_ten_review_shops',
    pass:
      branches.status === 200 &&
      [
        'Dar El Bahja',
        'Le Jardin d’El Biar',
        'Grillade des Oliviers',
        'Four de Didouche',
        'Maison du Blé',
        'Souk El Khemis',
        'Épicerie du Parc',
        'Pharmacie Atlas',
        'Glaces du Palmier',
        'Atelier Sucré',
      ].every((name) => names.includes(name)),
  });

  const restaurants = await json(
    `${API}/customer/branches?limit=50&verticalId=${EXISTING_VERTICALS.restaurants}`,
    token,
  );
  const bakeries = await json(
    `${API}/customer/branches?limit=50&verticalId=${VERTICAL_BAKERIES_ID}`,
    token,
  );
  report.filters = {
    restaurants: (restaurants.body?.items || []).map((b) => b.branchName),
    bakeries: (bakeries.body?.items || []).map((b) => b.branchName),
  };
  report.checks.push({
    name: 'vertical_filter_bakeries',
    pass:
      bakeries.status === 200 &&
      bakeries.body.items.length === 2 &&
      bakeries.body.items.every((b) =>
        ['Four de Didouche', 'Maison du Blé'].includes(b.branchName),
      ),
  });

  const searchStore = await json(
    `${API}/customer/catalog/search?q=${encodeURIComponent('Bahja')}&limit=20`,
    token,
  );
  const searchProduct = await json(
    `${API}/customer/catalog/search?q=${encodeURIComponent('Couscous')}&limit=20`,
    token,
  );
  report.search = {
    bahjaTypes: (searchStore.body?.items || []).map((i) => i.type),
    couscousHits: (searchProduct.body?.items || []).map((i) => ({
      type: i.type,
      name: i.product?.name || i.storefront?.branchName,
    })),
  };
  report.checks.push({
    name: 'search_storefront_and_product',
    pass:
      searchStore.status === 200 &&
      searchStore.body.items.some((i) => i.type === 'STOREFRONT') &&
      searchProduct.status === 200 &&
      searchProduct.body.items.some(
        (i) => i.type === 'PRODUCT' && i.product?.name === 'Couscous royal',
      ),
  });

  const dar = branchId(1);
  const menu = await json(`${API}/customer/branches/${dar}/categories`, token);
  const products = await json(`${API}/customer/branches/${dar}/products?limit=50`, token);
  const couscousId = productId(1, 1);
  const detail = await json(`${API}/customer/branches/${dar}/products/${couscousId}`, token);
  report.menu = {
    categories: (menu.body?.items || []).map((c) => c.name),
    productCount: products.body?.items?.length,
    couscous: {
      status: detail.status,
      name: detail.body?.name,
      priceMinor: detail.body?.priceMinor,
      expectedPriceMinor: money(120000),
      optionGroups: (detail.body?.optionGroups || []).map((g) => ({
        name: g.name,
        required: g.required,
        min: g.minSelections,
        max: g.maxSelections,
        options: (g.options || []).map((o) => `${o.name}:${o.additionalPriceMinor}`),
      })),
      hasImageField: Object.prototype.hasOwnProperty.call(detail.body || {}, 'imageUrl'),
      imageUrl: detail.body?.imageUrl ?? null,
    },
  };
  report.checks.push({
    name: 'menu_options_exact_prices',
    pass:
      detail.status === 200 &&
      detail.body.priceMinor === '120000' &&
      detail.body.optionGroups.some((g) => g.required === true && g.name === 'Taille') &&
      detail.body.optionGroups.some((g) => g.required === false) &&
      detail.body.optionGroups
        .find((g) => g.name === 'Taille')
        ?.options.some((o) => o.name === 'Grande' && o.additionalPriceMinor === '20000'),
  });
  report.checks.push({
    name: 'product_imageUrl_is_customer_path',
    pass:
      report.menu.couscous.hasImageField === true &&
      report.menu.couscous.imageUrl ===
        `/customer/branches/${dar}/products/${couscousId}/image`,
  });

  const hoursClosed = await json(`${API}/customer/branches/${branchId(7)}`, token);
  const hoursNone = await json(`${API}/customer/branches/${branchId(10)}`, token);
  const hours24 = await json(`${API}/customer/branches/${branchId(6)}`, token);
  report.hours = {
    epicerieDuParc: {
      hoursConfigured: hoursClosed.body?.hoursConfigured,
      isOpenNow: hoursClosed.body?.isOpenNow,
    },
    atelierSucre: {
      hoursConfigured: hoursNone.body?.hoursConfigured,
      isOpenNow: hoursNone.body?.isOpenNow,
    },
    soukElKhemis: {
      hoursConfigured: hours24.body?.hoursConfigured,
      isOpenNow: hours24.body?.isOpenNow,
    },
  };
  report.checks.push({
    name: 'closed_configured_case',
    pass:
      hoursClosed.status === 200 &&
      hoursClosed.body.hoursConfigured === true &&
      hoursClosed.body.isOpenNow === false,
  });
  report.checks.push({
    name: 'unconfigured_hours_case',
    pass:
      hoursNone.status === 200 &&
      hoursNone.body.hoursConfigured === false &&
      hoursNone.body.isOpenNow === false,
  });
  report.checks.push({
    name: 'twenty_four_hour_open',
    pass: hours24.status === 200 && hours24.body.hoursConfigured === true && hours24.body.isOpenNow === true,
  });

  const coverIds = [1, 2, 3, 6, 8, 9];
  report.covers = [];
  for (const n of coverIds) {
    const id = branchId(n);
    const res = await fetch(`${API}/customer/branches/${id}/cover`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const dest = join(OUT, `cover-store-${n}.jpg`);
    if (jpeg) {
      writeFileSync(dest, buf);
    }
    report.covers.push({
      store: n,
      status: res.status,
      contentType: res.headers.get('content-type'),
      bytes: buf.length,
      jpeg,
      saved: jpeg ? dest : null,
    });
  }
  report.checks.push({
    name: 'cover_bytes_are_jpeg',
    pass: report.covers.every((c) => c.status === 200 && c.jpeg && c.bytes > 20_000),
  });

  const productPhotos = [
    { storeN: 1, productP: 1, name: 'Couscous royal' },
    { storeN: 2, productP: 1, name: 'Salade du jardin' },
    { storeN: 3, productP: 1, name: 'Brochettes d’agneau' },
    { storeN: 4, productP: 21, name: 'Croissant au beurre' },
    { storeN: 4, productP: 22, name: 'Pain au chocolat' },
    { storeN: 6, productP: 1, name: 'Tomates 1 kg' },
    { storeN: 9, productP: 1, name: 'Cornet 2 boules' },
    { storeN: 10, productP: 7, name: 'Baklava' },
  ];
  report.productImages = [];
  for (const photo of productPhotos) {
    const bid = branchId(photo.storeN);
    const pid = productId(photo.storeN, photo.productP);
    const res = await fetch(
      `${API}/customer/branches/${bid}/products/${pid}/image`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const buf = Buffer.from(await res.arrayBuffer());
    const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const dest = join(OUT, `product-${photo.storeN}-${photo.productP}.jpg`);
    if (jpeg) {
      writeFileSync(dest, buf);
    }
    report.productImages.push({
      name: photo.name,
      productId: pid,
      status: res.status,
      contentType: res.headers.get('content-type'),
      bytes: buf.length,
      jpeg,
      saved: jpeg ? dest : null,
    });
  }
  report.checks.push({
    name: 'product_image_bytes_are_jpeg',
    pass: report.productImages.every((item) => item.status === 200 && item.jpeg && item.bytes > 20_000),
  });

  writeFileSync(join(OUT, 'customer-api-report.json'), JSON.stringify(report, null, 2));
  const failed = report.checks.filter((c) => !c.pass);
  console.log(JSON.stringify({ failed: failed.length, checks: report.checks, hours: report.hours, verticals: report.verticals, totals: report.storefronts.total }, null, 2));
  if (failed.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
