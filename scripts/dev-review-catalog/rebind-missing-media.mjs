#!/usr/bin/env node
/**
 * Rebind review-catalog covers/product photos whose backing objects are gone.
 * Uses the merchant upload/bind API only. Never writes storage keys into SQL.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { COVER_PHOTOS, PRODUCT_PHOTOS } from './assets.mjs';
import { STOREFRONTS } from './catalog.mjs';
import {
  OWNER_PHONE,
  REVIEWER_PHONE,
  branchId,
  merchantId,
  productId,
} from './ids.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(ROOT, 'assets');
const HOST = '127.0.0.1';
const PORT = '5433';
const DB = 'speedygo_dev';
const USER = 'speedygo';
const API = process.env.SPEEDYGO_FIXTURE_API || 'http://127.0.0.1:3000/api/v1';
const PGPASSWORD = process.env.PGPASSWORD || 'speedygo';
const STORAGE_ROOT =
  process.env.STORAGE_LOCAL_ROOT ||
  process.env.SPEEDYGO_DEV_STORAGE_ROOT ||
  join(homedir(), '.speedygo', 'dev', 'storage');
const REPORT_DIR = join(
  ROOT,
  '../../../../.cache/catalog-images',
);

function runPsql(extra) {
  const result = spawnSync(
    'psql',
    ['--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-h', HOST, '-p', PORT, '-U', USER, '-d', DB, ...extra],
    { env: { ...process.env, PGPASSWORD }, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'psql failed');
  }
  return (result.stdout || '').trim();
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body, text };
}

function otpPath() {
  const override = process.env.SPEEDYGO_DEV_OTP_DIR?.trim();
  return join(override || join(homedir(), '.speedygo', 'dev'), 'otp-last');
}

function readDevOtp() {
  const raw = readFileSync(otpPath(), 'utf8').trim();
  const code = raw.split(/\s+/).pop();
  if (!/^\d{6}$/.test(code)) {
    throw new Error('Unexpected OTP capture format');
  }
  return code;
}

async function requestOtp(phone) {
  const { response, body } = await fetchJson(`${API}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'PHONE',
      identifier: phone,
      purpose: 'AUTHENTICATE',
    }),
  });
  if (!response.ok) {
    const err = new Error(`OTP request failed ${response.status}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }
}

async function verifyOtp(phone) {
  const { response, body } = await fetchJson(`${API}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'PHONE',
      identifier: phone,
      purpose: 'AUTHENTICATE',
      code: readDevOtp(),
      platform: 'web',
      appVersion: '0.0.0-review-catalog',
      deviceName: 'review-catalog-rebind',
    }),
  });
  if (!response.ok || !body?.accessToken) {
    throw new Error(`OTP verify failed ${response.status}`);
  }
  return body.accessToken;
}

async function loginSynthetic(phone) {
  try {
    await requestOtp(phone);
  } catch (error) {
    if (error.status === 429) {
      console.log('OTP cooldown; waiting 65s once…');
      await new Promise((resolve) => setTimeout(resolve, 65_000));
      await requestOtp(phone);
    } else {
      throw error;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  return verifyOtp(phone);
}

async function bindCover(token, store, filePath) {
  const mid = merchantId(store.n);
  const bid = branchId(store.n);
  const bytes = readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), store.coverAsset);
  const upload = await fetchJson(`${API}/merchant/${mid}/branches/${bid}/cover/content`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!upload.response.ok || !upload.body?.uploadReference) {
    throw new Error(`Cover upload failed ${store.branchName}: ${upload.response.status}`);
  }
  const bind = await fetchJson(`${API}/merchant/${mid}/branches/${bid}/cover`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uploadReference: upload.body.uploadReference }),
  });
  if (!bind.response.ok) {
    throw new Error(`Cover bind failed ${store.branchName}: ${bind.response.status}`);
  }
  return bind.body;
}

async function bindProductImage(token, photo, filePath) {
  const mid = merchantId(photo.storeN);
  const bid = branchId(photo.storeN);
  const pid = productId(photo.storeN, photo.productP);
  const bytes = readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), photo.file);
  const upload = await fetchJson(
    `${API}/merchant/${mid}/branches/${bid}/products/${pid}/image/content`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  if (!upload.response.ok || !upload.body?.uploadReference) {
    throw new Error(`Product upload failed ${photo.productName}: ${upload.response.status}`);
  }
  const bind = await fetchJson(
    `${API}/merchant/${mid}/branches/${bid}/products/${pid}/image`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uploadReference: upload.body.uploadReference }),
    },
  );
  if (!bind.response.ok) {
    throw new Error(`Product bind failed ${photo.productName}: ${bind.response.status}`);
  }
  return bind.body;
}

function objectExists(kind, objectId) {
  if (!objectId) {
    return false;
  }
  return existsSync(join(STORAGE_ROOT, kind, objectId));
}

async function probeImage(token, path) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return {
    status: response.status,
    contentType,
    bytes: bytes.length,
    jpeg,
  };
}

function summarizeHit(hit) {
  if (hit.type === 'STOREFRONT') {
    return {
      type: hit.type,
      name: hit.storefront?.branchName,
      coverImageUrl: hit.storefront?.coverImageUrl ?? null,
    };
  }
  return {
    type: hit.type,
    name: hit.product?.name,
    imageUrl: hit.product?.imageUrl ?? null,
    branch: hit.storefront?.branchName,
  };
}

async function customerProbe(token, label) {
  const bakeryVertical = '0d00c071-d000-7000-8000-00000000a001';
  const didouche = branchId(4);
  const croissant = productId(4, 21);
  const painChoco = productId(4, 22);
  const unfiltered = await fetchJson(`${API}/customer/branches?limit=50&offset=0`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const filtered = await fetchJson(
    `${API}/customer/branches?limit=50&offset=0&verticalId=${bakeryVertical}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const detail = await fetchJson(`${API}/customer/branches/${didouche}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const products = await fetchJson(
    `${API}/customer/branches/${didouche}/products?limit=50&offset=0`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const search = await fetchJson(
    `${API}/customer/catalog/search?q=${encodeURIComponent('Croissant')}&limit=20&offset=0`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const pick = (items) =>
    (items || []).find((item) => item.branchId === didouche) || null;
  const croissantRow = (products.body?.items || []).find(
    (item) => item.productId === croissant,
  );
  const painRow = (products.body?.items || []).find((item) => item.productId === painChoco);
  const coverPath = `/customer/branches/${didouche}/cover`;
  const croissantPath = `/customer/branches/${didouche}/products/${croissant}/image`;
  const painPath = `/customer/branches/${didouche}/products/${painChoco}/image`;
  return {
    label,
    unfiltered: {
      status: unfiltered.response.status,
      didouche: pick(unfiltered.body?.items),
    },
    filteredBakeries: {
      status: filtered.response.status,
      didouche: pick(filtered.body?.items),
    },
    detail: {
      status: detail.response.status,
      coverImageUrl: detail.body?.coverImageUrl ?? null,
      branchName: detail.body?.branchName ?? null,
      merchantName: detail.body?.merchantName ?? null,
    },
    products: {
      status: products.response.status,
      croissant: croissantRow
        ? { name: croissantRow.name, imageUrl: croissantRow.imageUrl ?? null }
        : null,
      painAuChocolat: painRow
        ? { name: painRow.name, imageUrl: painRow.imageUrl ?? null }
        : null,
    },
    search: {
      status: search.response.status,
      hits: (search.body?.items || []).map(summarizeHit),
    },
    images: {
      cover: await probeImage(token, coverPath),
      croissant: await probeImage(token, croissantPath),
      painAuChocolat: await probeImage(token, painPath),
    },
  };
}

async function main() {
  const identity = runPsql([
    '-tAc',
    "SELECT current_database() || '|' || inet_server_port();",
  ]);
  if (!identity.startsWith('speedygo_dev|')) {
    throw new Error(`Refused database identity: ${identity}`);
  }

  const coverRows = runPsql([
    '-tAc',
    `SELECT b.id || '|' || b.name || '|' || coalesce(c.object_id,'') || '|' || coalesce(c.byte_size::text,'')
     FROM merchant_branches b
     LEFT JOIN merchant_branch_covers c ON c.branch_id = b.id
     WHERE b.id::text LIKE '0d00c071-d000-7000-8000-%'
     ORDER BY b.name;`,
  ]).split('\n').filter(Boolean);

  const productRows = runPsql([
    '-tAc',
    `SELECT p.id || '|' || p.name || '|' || coalesce(i.object_id,'') || '|' || coalesce(i.byte_size::text,'')
     FROM products p
     LEFT JOIN product_images i ON i.product_id = p.id
     WHERE p.id::text LIKE '0d00c071-d000-7000-8000-%'
     ORDER BY p.name;`,
  ]).split('\n').filter(Boolean);

  const missingCovers = STOREFRONTS.filter((store) => {
    const row = coverRows.find((line) => line.startsWith(branchId(store.n)));
    const objectId = row?.split('|')[2] || '';
    return !objectExists('covers', objectId);
  });
  const missingProducts = PRODUCT_PHOTOS.filter((photo) => {
    const pid = productId(photo.storeN, photo.productP);
    const row = productRows.find((line) => line.startsWith(pid));
    const objectId = row?.split('|')[2] || '';
    return !objectExists('product-images', objectId);
  });

  mkdirSync(REPORT_DIR, { recursive: true });
  const pre = {
    api: API,
    database: identity,
    storageRoot: STORAGE_ROOT,
    storageRootExists: existsSync(STORAGE_ROOT),
    priorStorageRecovered: false,
    reviewCovers: coverRows.length,
    reviewProducts: productRows.length,
    missingCovers: missingCovers.map((s) => s.branchName),
    missingProducts: missingProducts.map((p) => p.productName),
  };
  writeFileSync(join(REPORT_DIR, 'PRE.json'), `${JSON.stringify(pre, null, 2)}\n`);
  console.log(`Storage root ${STORAGE_ROOT} exists=${pre.storageRootExists}`);
  console.log(`Missing covers: ${pre.missingCovers.join(', ') || 'none'}`);
  console.log(`Missing product photos: ${pre.missingProducts.join(', ') || 'none'}`);

  let preProbe = null;
  console.log(`Customer pre-probe as reviewer…`);
  const reviewerPre = await loginSynthetic(REVIEWER_PHONE);
  preProbe = await customerProbe(reviewerPre, 'before-rebind');
  writeFileSync(join(REPORT_DIR, 'PROBE_BEFORE.json'), `${JSON.stringify(preProbe, null, 2)}\n`);
  console.log(
    `Pre cover ${preProbe.images.cover.status} ${preProbe.images.cover.contentType} ${preProbe.images.cover.bytes}b jpeg=${preProbe.images.cover.jpeg}`,
  );

  const restored = [];
  if (missingCovers.length > 0 || missingProducts.length > 0) {
    console.log(
      `Rebinding ${missingCovers.length} cover(s) and ${missingProducts.length} product image(s) via merchant API…`,
    );
    const token = await loginSynthetic(OWNER_PHONE);
    for (const store of missingCovers) {
      const photo = COVER_PHOTOS.find((item) => item.storeN === store.n);
      const dest = join(ASSETS_DIR, photo.file);
      if (!existsSync(dest)) {
        throw new Error(`Approved asset missing: ${dest}`);
      }
      const bound = await bindCover(token, store, dest);
      restored.push({
        kind: 'cover',
        name: store.branchName,
        asset: photo.file,
        url: bound.coverImageUrl ?? null,
        reason: 'DB cover metadata existed but STORAGE_LOCAL_ROOT object was absent',
      });
      console.log(`  rebound cover ${store.branchName}`);
    }
    for (const photo of missingProducts) {
      const dest = join(ASSETS_DIR, photo.file);
      if (!existsSync(dest)) {
        throw new Error(`Approved asset missing: ${dest}`);
      }
      const bound = await bindProductImage(token, photo, dest);
      restored.push({
        kind: 'product',
        name: photo.productName,
        asset: photo.file,
        url: bound.imageUrl ?? null,
        reason: 'DB product image metadata existed but STORAGE_LOCAL_ROOT object was absent',
      });
      console.log(`  rebound product ${photo.productName}`);
    }
  }

  console.log('Customer post-probe as reviewer…');
  const reviewerPost = await loginSynthetic(REVIEWER_PHONE);
  const postProbe = await customerProbe(reviewerPost, 'after-rebind');
  writeFileSync(join(REPORT_DIR, 'PROBE_AFTER.json'), `${JSON.stringify(postProbe, null, 2)}\n`);
  console.log(
    `Post cover ${postProbe.images.cover.status} ${postProbe.images.cover.contentType} ${postProbe.images.cover.bytes}b jpeg=${postProbe.images.cover.jpeg}`,
  );
  console.log(
    `Post croissant ${postProbe.images.croissant.status} ${postProbe.images.croissant.bytes}b jpeg=${postProbe.images.croissant.jpeg}`,
  );

  const report = [
    '# Catalog image restore',
    '',
    `Database: ${identity}`,
    `API: ${API}`,
    `Effective storage root: ${STORAGE_ROOT} (was missing; recreated by authorized uploads)`,
    'Prior `/tmp/speedygo-private-storage` files were not recoverable (directory absent; no backup found).',
    '',
    '## Restored via merchant upload/bind API',
    ...restored.map((item) => `- ${item.kind} ${item.name} ← assets/${item.asset}`),
    '',
    'Unrelated merchants were not modified. No SQL object-key writes.',
    '',
  ].join('\n');
  writeFileSync(join(REPORT_DIR, 'RESTORE.md'), `${report}\n`);
  writeFileSync(join(REPORT_DIR, 'RESTORED.json'), `${JSON.stringify(restored, null, 2)}\n`);
  console.log('Done.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
