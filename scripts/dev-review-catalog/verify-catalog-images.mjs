#!/usr/bin/env node
/** Authenticated Customer image checks against the running API. No tokens printed. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { branchId, productId, REVIEWER_PHONE } from './ids.mjs';

const API = process.env.SPEEDYGO_FIXTURE_API || 'http://127.0.0.1:3000/api/v1';

function readDevOtp() {
  const override = process.env.SPEEDYGO_DEV_OTP_DIR?.trim();
  const path = join(override || join(homedir(), '.speedygo', 'dev'), 'otp-last');
  const code = readFileSync(path, 'utf8').trim().split(/\s+/).pop();
  if (!/^\d{6}$/.test(code)) {
    throw new Error('Unexpected OTP capture format');
  }
  return code;
}

async function login(phone) {
  let req = await fetch(`${API}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'PHONE',
      identifier: phone,
      purpose: 'AUTHENTICATE',
    }),
  });
  if (req.status === 429) {
    console.log('OTP cooldown; waiting 65s once…');
    await new Promise((r) => setTimeout(r, 65_000));
    req = await fetch(`${API}/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'PHONE',
        identifier: phone,
        purpose: 'AUTHENTICATE',
      }),
    });
  }
  if (!req.ok) {
    throw new Error(`OTP request ${req.status}`);
  }
  await new Promise((r) => setTimeout(r, 250));
  const verify = await fetch(`${API}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'PHONE',
      identifier: phone,
      purpose: 'AUTHENTICATE',
      code: readDevOtp(),
      platform: 'web',
      appVersion: '0.0.0-storage-verify',
      deviceName: 'dev-storage-verify',
    }),
  });
  const body = await verify.json();
  if (!verify.ok || !body?.accessToken) {
    throw new Error(`OTP verify ${verify.status}`);
  }
  return body.accessToken;
}

async function probe(token, path) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e;
  const imageType = contentType.toLowerCase().startsWith('image/');
  return {
    path,
    status: response.status,
    contentType,
    bytes: bytes.length,
    validImage: imageType && (jpeg || png),
  };
}

function assertOk(result) {
  if (result.status !== 200 || !result.validImage) {
    throw new Error(
      `FAIL ${result.path} status=${result.status} type=${result.contentType} bytes=${result.bytes} valid=${result.validImage}`,
    );
  }
}

async function main() {
  const label = process.argv[2] || 'check';
  const didouche = branchId(4);
  const token = await login(REVIEWER_PHONE);
  const results = {
    label,
    storageHint: process.env.STORAGE_LOCAL_ROOT || null,
    cover: await probe(token, `/customer/branches/${didouche}/cover`),
    croissant: await probe(
      token,
      `/customer/branches/${didouche}/products/${productId(4, 21)}/image`,
    ),
    painAuChocolat: await probe(
      token,
      `/customer/branches/${didouche}/products/${productId(4, 22)}/image`,
    ),
  };
  for (const key of ['cover', 'croissant', 'painAuChocolat']) {
    assertOk(results[key]);
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
