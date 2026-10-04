#!/usr/bin/env node
/**
 * Apply the review-catalog fixture to speedygo_dev and bind covers via the
 * merchant upload/bind API. Never writes storage keys into the database.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVER_PHOTOS, PRODUCT_PHOTOS, WIKIMEDIA_USER_AGENT } from './assets.mjs';
import { STOREFRONTS } from './catalog.mjs';
import { generateReviewCatalogSql } from './generate-sql.mjs';
import {
  OWNER_PHONE,
  REVIEWER_PHONE,
  branchId,
  merchantId,
  productId,
} from './ids.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = join(ROOT, 'seed.sql');
const ASSETS_DIR = join(ROOT, 'assets');
const HOST = process.env.SPEEDYGO_FIXTURE_PGHOST || '127.0.0.1';
const PORT = process.env.SPEEDYGO_FIXTURE_PGPORT || '5433';
const DB = process.env.SPEEDYGO_FIXTURE_PGDATABASE || 'speedygo_dev';
const USER = process.env.SPEEDYGO_FIXTURE_PGUSER || 'speedygo';
const API = process.env.SPEEDYGO_FIXTURE_API || 'http://127.0.0.1:3000/api/v1';
const PGPASSWORD = process.env.PGPASSWORD || 'speedygo';

if (HOST !== '127.0.0.1' || PORT !== '5433' || DB !== 'speedygo_dev') {
  console.error(
    'Refused: review catalog fixture is locked to 127.0.0.1:5433 / speedygo_dev',
  );
  process.exit(1);
}

function psqlArgs(extra) {
  return ['--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-h', HOST, '-p', PORT, '-U', USER, '-d', DB, ...extra];
}

function runPsql(extra, input) {
  const env = { ...process.env, PGPASSWORD };
  if (commandExists('psql')) {
    const result = spawnSync('psql', psqlArgs(extra), {
      env,
      encoding: 'utf8',
      input,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'psql failed');
    }
    return (result.stdout || '').trim();
  }
  const dockerArgs = [
    'exec',
    '-i',
    '-e',
    `PGPASSWORD=${PGPASSWORD}`,
    'speedygo-postgres',
    'psql',
    '--no-psqlrc',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    USER,
    '-d',
    DB,
    ...extra,
  ];
  const result = spawnSync('docker', dockerArgs, {
    env,
    encoding: 'utf8',
    input,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'docker psql failed');
  }
  return (result.stdout || '').trim();
}

function commandExists(name) {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sqlStr(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
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

async function downloadCover(photo) {
  mkdirSync(ASSETS_DIR, { recursive: true });
  const dest = join(ASSETS_DIR, photo.file);
  if (existsSync(dest) && readFileSync(dest).length > 20_000) {
    return dest;
  }
  const api =
    'https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1600&format=json&titles=' +
    encodeURIComponent(photo.commonsTitle);
  let metaRes;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    metaRes = await fetch(api, {
      headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
    });
    if (metaRes.ok) {
      break;
    }
    if ((metaRes.status === 429 || metaRes.status >= 500) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 2500 * attempt));
      continue;
    }
    throw new Error(`Commons metadata failed for ${photo.commonsTitle}: ${metaRes.status}`);
  }
  const meta = await metaRes.json();
  const page = Object.values(meta.query.pages)[0];
  const info = page?.imageinfo?.[0];
  const url = info?.thumburl || info?.url;
  if (!url) {
    throw new Error(`No download URL for ${photo.commonsTitle}`);
  }
  let imgRes;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    imgRes = await fetch(url, {
      headers: { 'User-Agent': WIKIMEDIA_USER_AGENT, Accept: 'image/*' },
    });
    if (imgRes.ok) {
      break;
    }
    if ((imgRes.status === 429 || imgRes.status >= 500) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 2500 * attempt));
      continue;
    }
    throw new Error(`Download failed ${photo.commonsTitle}: ${imgRes.status}`);
  }
  const bytes = Buffer.from(await imgRes.arrayBuffer());
  writeFileSync(dest, bytes);
  optimizeJpeg(dest);
  return dest;
}

function optimizeJpeg(path) {
  if (!commandExists('sips')) {
    return;
  }
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '1600', path], {
    stdio: 'ignore',
  });
  const size = readFileSync(path).length;
  if (size > 2 * 1024 * 1024) {
    execFileSync(
      'sips',
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', '1400', path],
      { stdio: 'ignore' },
    );
  }
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

function readDevOtp() {
  const override = process.env.SPEEDYGO_DEV_OTP_DIR?.trim();
  const path = override
    ? join(override, 'otp-last')
    : join(homedir(), '.speedygo', 'dev', 'otp-last');
  const raw = readFileSync(path, 'utf8').trim();
  const code = raw.split(/\s+/).pop();
  if (!/^\d{6}$/.test(code)) {
    throw new Error(`Unexpected OTP file contents: ${raw}`);
  }
  return code;
}

async function verifyOtp(phone) {
  const code = readDevOtp();
  const { response, body } = await fetchJson(`${API}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'PHONE',
      identifier: phone,
      purpose: 'AUTHENTICATE',
      code,
      platform: 'web',
      appVersion: '0.0.0-review-catalog',
      deviceName: 'review-catalog-seed',
    }),
  });
  if (!response.ok || !body?.accessToken) {
    throw new Error(`OTP verify failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.accessToken;
}

async function loginSynthetic(phone) {
  try {
    await requestOtp(phone);
  } catch (error) {
    if (error.status === 429) {
      console.log(`OTP cooldown for ${phone}; waiting 65s once…`);
      await new Promise((resolve) => setTimeout(resolve, 65_000));
      await requestOtp(phone);
    } else {
      throw error;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  return verifyOtp(phone);
}

async function bindCover(token, store, filePath) {
  const mid = merchantId(store.n);
  const bid = branchId(store.n);
  const bytes = readFileSync(filePath);
  if (bytes.length > 2 * 1024 * 1024) {
    throw new Error(`${filePath} exceeds 2 MiB after optimize (${bytes.length})`);
  }
  const form = new FormData();
  form.append(
    'file',
    new Blob([bytes], { type: 'image/jpeg' }),
    store.coverAsset,
  );
  const upload = await fetchJson(
    `${API}/merchant/${mid}/branches/${bid}/cover/content`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  if (!upload.response.ok || !upload.body?.uploadReference) {
    throw new Error(
      `Cover upload failed ${store.branchName}: ${upload.response.status} ${JSON.stringify(upload.body)}`,
    );
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
    throw new Error(
      `Cover bind failed ${store.branchName}: ${bind.response.status} ${JSON.stringify(bind.body)}`,
    );
  }
  return bind.body;
}

function existingCoverBranchIds() {
  const ids = STOREFRONTS.map((store) => branchId(store.n));
  const list = ids.map(sqlStr).join(',');
  const raw = runPsql([
    '-tAc',
    `SELECT branch_id FROM merchant_branch_covers WHERE branch_id IN (${list})`,
  ]);
  return new Set(raw.split('\n').map((line) => line.trim()).filter(Boolean));
}

function existingProductImageIds() {
  const ids = PRODUCT_PHOTOS.map((photo) => productId(photo.storeN, photo.productP));
  const list = ids.map(sqlStr).join(',');
  const raw = runPsql([
    '-tAc',
    `SELECT product_id FROM product_images WHERE product_id IN (${list})`,
  ]);
  return new Set(raw.split('\n').map((line) => line.trim()).filter(Boolean));
}

async function bindProductImage(token, photo, filePath) {
  const mid = merchantId(photo.storeN);
  const bid = branchId(photo.storeN);
  const pid = productId(photo.storeN, photo.productP);
  const bytes = readFileSync(filePath);
  if (bytes.length > 2 * 1024 * 1024) {
    throw new Error(`${filePath} exceeds 2 MiB after optimize (${bytes.length})`);
  }
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
    throw new Error(
      `Product image upload failed ${photo.productName}: ${upload.response.status} ${JSON.stringify(upload.body)}`,
    );
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
    throw new Error(
      `Product image bind failed ${photo.productName}: ${bind.response.status} ${JSON.stringify(bind.body)}`,
    );
  }
  return bind.body;
}

function printCounts() {
  const prefix = '0d00c071-d000-7000-8000-%';
  const sql = `
    SELECT 'verticals' AS kind, COUNT(*) FROM commerce_verticals WHERE id::text LIKE '${prefix}'
    UNION ALL SELECT 'accounts', COUNT(*) FROM accounts WHERE id::text LIKE '${prefix}'
    UNION ALL SELECT 'merchants', COUNT(*) FROM merchants WHERE id::text LIKE '${prefix}'
    UNION ALL SELECT 'branches', COUNT(*) FROM merchant_branches WHERE id::text LIKE '${prefix}'
    UNION ALL SELECT 'classifications', COUNT(*) FROM merchant_branch_classifications WHERE id::text LIKE '${prefix}'
    UNION ALL SELECT 'members', COUNT(*) FROM merchant_members WHERE id::text LIKE '${prefix}'
    UNION ALL SELECT 'schedules', COUNT(*) FROM merchant_branch_opening_schedules WHERE id::text LIKE '${prefix}'
    UNION ALL SELECT 'intervals', COUNT(*) FROM merchant_branch_opening_intervals WHERE id::text LIKE '${prefix}'
    UNION ALL SELECT 'categories', COUNT(*) FROM categories WHERE id::text LIKE '${prefix}'
    UNION ALL SELECT 'products', COUNT(*) FROM products WHERE id::text LIKE '${prefix}'
    UNION ALL SELECT 'option_groups', COUNT(*) FROM product_option_groups WHERE id::text LIKE '${prefix}'
    UNION ALL SELECT 'options', COUNT(*) FROM product_options WHERE id::text LIKE '${prefix}'
    UNION ALL SELECT 'covers', COUNT(*) FROM merchant_branch_covers WHERE branch_id::text LIKE '${prefix}'
    UNION ALL SELECT 'product_images', COUNT(*) FROM product_images WHERE product_id::text LIKE '${prefix}';
  `;
  console.log(runPsql(['-c', sql]));
}

async function main() {
  const identity = runPsql([
    '-tAc',
    "SELECT current_database() || '|' || inet_server_addr() || '|' || inet_server_port();",
  ]);
  const dbName = identity.split('|')[0];
  if (dbName !== 'speedygo_dev') {
    console.error(`Refused: current_database() is '${dbName}'`);
    process.exit(1);
  }
  console.log(`Verified database identity: ${identity}`);

  const sql = generateReviewCatalogSql();
  writeFileSync(SQL_PATH, `${sql}\n`, 'utf8');
  console.log(`Wrote ${SQL_PATH}`);
  runPsql(['-f', SQL_PATH]);
  console.log('SQL fixture applied (ON CONFLICT DO NOTHING).');

  console.log('Downloading licensed cover photographs…');
  for (const photo of COVER_PHOTOS) {
    const dest = await downloadCover(photo);
    console.log(`  ${photo.file} (${readFileSync(dest).length} bytes)`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const extraProductPhotos = PRODUCT_PHOTOS.filter(
    (photo) => !COVER_PHOTOS.some((cover) => cover.file === photo.file),
  );
  if (extraProductPhotos.length > 0) {
    console.log('Downloading licensed product photographs…');
    for (const photo of extraProductPhotos) {
      const dest = await downloadCover(photo);
      console.log(`  ${photo.file} (${readFileSync(dest).length} bytes)`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  const alreadyCovers = existingCoverBranchIds();
  const pendingCovers = STOREFRONTS.filter((store) => !alreadyCovers.has(branchId(store.n)));
  const alreadyImages = existingProductImageIds();
  const pendingImages = PRODUCT_PHOTOS.filter(
    (photo) => !alreadyImages.has(productId(photo.storeN, photo.productP)),
  );
  if (pendingCovers.length === 0 && pendingImages.length === 0) {
    console.log('All review-catalog covers and product images already bound; skipping OTP/upload.');
  } else {
    console.log(
      `Binding ${pendingCovers.length} cover(s) and ${pendingImages.length} product image(s) via merchant API as ${OWNER_PHONE}…`,
    );
    const token = await loginSynthetic(OWNER_PHONE);
    for (const store of pendingCovers) {
      const photo = COVER_PHOTOS.find((item) => item.storeN === store.n);
      const dest = join(ASSETS_DIR, photo.file);
      const bound = await bindCover(token, store, dest);
      console.log(`  bound cover ${store.branchName} → ${bound.coverImageUrl}`);
    }
    for (const photo of pendingImages) {
      const dest = join(ASSETS_DIR, photo.file);
      const bound = await bindProductImage(token, photo, dest);
      console.log(`  bound product ${photo.productName} → ${bound.imageUrl}`);
    }
  }

  console.log('Fixture namespace counts:');
  printCounts();
  console.log(`Synthetic reviewer customer (API only, no merchant role): ${REVIEWER_PHONE}`);
  console.log('Done. No orders, payments, promotions, or live-account grants.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
