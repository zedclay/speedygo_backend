#!/usr/bin/env node
/**
 * Apply synthetic Checkout preview fixtures to speedygo_dev via audited Admin API.
 * Locked to 127.0.0.1:5433 / speedygo_dev. Idempotent by fixture names.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.SPEEDYGO_FIXTURE_PGHOST || '127.0.0.1';
const PORT = process.env.SPEEDYGO_FIXTURE_PGPORT || '5433';
const DB = process.env.SPEEDYGO_FIXTURE_PGDATABASE || 'speedygo_dev';
const USER = process.env.SPEEDYGO_FIXTURE_PGUSER || 'speedygo';
const API = process.env.SPEEDYGO_FIXTURE_API || 'http://127.0.0.1:3000/api/v1';
const PGPASSWORD = process.env.PGPASSWORD || 'speedygo';
const REPORT_DIR =
  process.env.SPEEDYGO_FIXTURE_REPORT_DIR ||
  join(ROOT, '../../../..', '.cache/fixture-reports');

const ADMIN_PHONE = '+213550000097';
const ADMIN_ACCOUNT_ID = '0d00c072-d000-7000-8000-000000000001';
const ZONE_NAME = 'SpeedyGo Dev Revue Hydra Zone';
const RULE_NAME = 'SpeedyGo Dev Revue Hydra All-Day';
const COVERING_RING = [
  [3.0, 36.7],
  [3.1, 36.7],
  [3.1, 36.8],
  [3.0, 36.8],
  [3.0, 36.7],
];
const CUSTOMER_FEE_MINOR = 500;
const DRIVER_REMUN_MINOR = 300;
const INSIDE_POINT = { lat: 36.7538, lon: 3.0588 };

if (HOST !== '127.0.0.1' || PORT !== '5433' || DB !== 'speedygo_dev') {
  console.error(
    'Refused: checkout fixtures locked to 127.0.0.1:5433 / speedygo_dev',
  );
  process.exit(1);
}

function commandExists(name) {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function psqlArgs(extra) {
  return [
    '--no-psqlrc',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    HOST,
    '-p',
    PORT,
    '-U',
    USER,
    '-d',
    DB,
    ...extra,
  ];
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

function resolveOtpPath() {
  const fromEnv = process.env.SPEEDYGO_DEV_OTP_FILE?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return join(homedir(), '.speedygo', 'dev', 'otp-last');
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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readDevOtp() {
  const path = resolveOtpPath();
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf8').trim();
      const code = raw.split(/\s+/).pop();
      if (/^\d{6}$/.test(code)) {
        return code;
      }
    }
    await sleep(150);
  }
  throw new Error(`OTP not found at ${path}`);
}

async function verifyOtp(phone) {
  const code = await readDevOtp();
  const { response, body } = await fetchJson(`${API}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'PHONE',
      identifier: phone,
      purpose: 'AUTHENTICATE',
      code,
      platform: 'web',
      appVersion: '0.0.0-dev-checkout-fixtures',
      deviceName: 'dev-checkout-fixtures',
    }),
  });
  if (!response.ok || !body?.accessToken) {
    throw new Error(
      `OTP verify failed ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken ?? null,
  };
}

async function loginSynthetic(phone) {
  const otpPath = resolveOtpPath();
  if (existsSync(otpPath)) {
    unlinkSync(otpPath);
  }
  try {
    await requestOtp(phone);
  } catch (error) {
    if (error.status === 429) {
      console.log(`OTP cooldown for ${phone}; waiting 65s once…`);
      await new Promise((resolve) => setTimeout(resolve, 65_000));
      if (existsSync(otpPath)) {
        unlinkSync(otpPath);
      }
      await requestOtp(phone);
    } else {
      throw error;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  return verifyOtp(phone);
}

async function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function listZones(token) {
  const { response, body } = await fetchJson(
    `${API}/admin/delivery/zones?limit=100&offset=0`,
    { headers: await authHeaders(token) },
  );
  if (!response.ok) {
    throw new Error(`List zones failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.items ?? [];
}

async function listRules(token, zoneId) {
  const qs = new URLSearchParams({
    limit: '100',
    offset: '0',
    zoneId,
  });
  const { response, body } = await fetchJson(
    `${API}/admin/delivery/pricing-rules?${qs}`,
    { headers: await authHeaders(token) },
  );
  if (!response.ok) {
    throw new Error(`List rules failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.items ?? [];
}

async function ensureZone(token) {
  const existing = (await listZones(token)).find((z) => z.name === ZONE_NAME);
  if (existing) {
    if (!existing.active) {
      const { response, body } = await fetchJson(
        `${API}/admin/delivery/zones/${existing.id}/activate`,
        {
          method: 'POST',
          headers: await authHeaders(token),
          body: '{}',
        },
      );
      if (!response.ok) {
        throw new Error(
          `Activate existing zone failed ${response.status}: ${JSON.stringify(body)}`,
        );
      }
      return { zone: body, created: false, activated: true };
    }
    return { zone: existing, created: false, activated: false };
  }

  const create = await fetchJson(`${API}/admin/delivery/zones`, {
    method: 'POST',
    headers: await authHeaders(token),
    body: JSON.stringify({
      name: ZONE_NAME,
      geometry: { type: 'Polygon', coordinates: [COVERING_RING] },
    }),
  });
  if (!create.response.ok) {
    throw new Error(
      `Create zone failed ${create.response.status}: ${JSON.stringify(create.body)}`,
    );
  }
  const activate = await fetchJson(
    `${API}/admin/delivery/zones/${create.body.id}/activate`,
    {
      method: 'POST',
      headers: await authHeaders(token),
      body: '{}',
    },
  );
  if (!activate.response.ok) {
    throw new Error(
      `Activate zone failed ${activate.response.status}: ${JSON.stringify(activate.body)}`,
    );
  }
  return { zone: activate.body, created: true, activated: true };
}

async function ensureRule(token, zoneId) {
  const existing = (await listRules(token, zoneId)).find(
    (r) => r.name === RULE_NAME,
  );
  if (existing) {
    if (!existing.active) {
      const { response, body } = await fetchJson(
        `${API}/admin/delivery/pricing-rules/${existing.id}/activate`,
        {
          method: 'POST',
          headers: await authHeaders(token),
          body: '{}',
        },
      );
      if (!response.ok) {
        throw new Error(
          `Activate existing rule failed ${response.status}: ${JSON.stringify(body)}`,
        );
      }
      return { rule: body, created: false, activated: true };
    }
    return { rule: existing, created: false, activated: false };
  }

  const create = await fetchJson(`${API}/admin/delivery/pricing-rules`, {
    method: 'POST',
    headers: await authHeaders(token),
    body: JSON.stringify({
      zoneId,
      name: RULE_NAME,
      timeBand: 'DAY',
      customerDeliveryFeeMinor: CUSTOMER_FEE_MINOR,
      driverRemunerationMinor: DRIVER_REMUN_MINOR,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
    }),
  });
  if (!create.response.ok) {
    throw new Error(
      `Create rule failed ${create.response.status}: ${JSON.stringify(create.body)}`,
    );
  }
  const activate = await fetchJson(
    `${API}/admin/delivery/pricing-rules/${create.body.id}/activate`,
    {
      method: 'POST',
      headers: await authHeaders(token),
      body: '{}',
    },
  );
  if (!activate.response.ok) {
    throw new Error(
      `Activate rule failed ${activate.response.status}: ${JSON.stringify(activate.body)}`,
    );
  }
  return { rule: activate.body, created: true, activated: true };
}

function pointInCoveringRing(lat, lon) {
  // Axis-aligned rectangle covering_ring for the documented fixture polygon.
  return lon >= 3.0 && lon <= 3.1 && lat >= 36.7 && lat <= 36.8;
}

function counts() {
  const raw = runPsql([
    '-tAc',
    `SELECT json_build_object(
      'delivery_zones', (SELECT count(*)::int FROM delivery_zones),
      'delivery_zones_active', (SELECT count(*)::int FROM delivery_zones WHERE active),
      'delivery_pricing_rules', (SELECT count(*)::int FROM delivery_pricing_rules),
      'delivery_pricing_rules_active', (SELECT count(*)::int FROM delivery_pricing_rules WHERE active),
      'orders', (SELECT count(*)::int FROM orders),
      'promotion_redemptions', (SELECT count(*)::int FROM promotion_redemptions)
    );`,
  ]);
  return JSON.parse(raw);
}

async function main() {
  const identity = runPsql([
    '-tAc',
    "SELECT current_database() || '|' || coalesce(inet_server_addr()::text,'') || '|' || coalesce(inet_server_port()::text,'');",
  ]);
  if (!identity.startsWith('speedygo_dev|')) {
    throw new Error(`Refused DB identity: ${identity}`);
  }
  console.log(`Verified database identity: ${identity}`);

  const before = counts();
  console.log('Before:', JSON.stringify(before));

  runPsql(['-f', join(ROOT, 'seed-admin.sql')]);
  // Clear permission cache for the synthetic admin so grants are visible immediately.
  try {
    if (commandExists('redis-cli')) {
      spawnSync(
        'redis-cli',
        ['-n', '0', 'DEL', `auth:perm:${ADMIN_ACCOUNT_ID}`],
        { encoding: 'utf8' },
      );
    }
  } catch {
    // Cache miss is fine; TTL is short.
  }

  if (!pointInCoveringRing(INSIDE_POINT.lat, INSIDE_POINT.lon)) {
    throw new Error('Fixture ring does not cover Revue checkout coordinates');
  }

  const session = await loginSynthetic(ADMIN_PHONE);
  // Never print tokens. Drop refresh immediately — fixture run is one-shot.
  const token = session.accessToken;
  session.refreshToken = null;

  const zoneResult = await ensureZone(token);
  const ruleResult = await ensureRule(token, zoneResult.zone.id);
  const after = counts();

  const report = {
    target: { host: HOST, port: PORT, database: DB, api: API },
    databaseIdentity: identity,
    before,
    after,
    zone: {
      id: zoneResult.zone.id,
      name: zoneResult.zone.name,
      active: zoneResult.zone.active,
      created: zoneResult.created,
      activated: zoneResult.activated,
      geometry: zoneResult.zone.geometry,
      covers: INSIDE_POINT,
    },
    pricingRule: {
      id: ruleResult.rule.id,
      name: ruleResult.rule.name,
      zoneId: ruleResult.rule.zoneId,
      active: ruleResult.rule.active,
      created: ruleResult.created,
      activated: ruleResult.activated,
      timeBand: ruleResult.rule.timeBand,
      startLocalTime: ruleResult.rule.startLocalTime,
      endLocalTime: ruleResult.rule.endLocalTime,
      customerDeliveryFeeMinor: ruleResult.rule.customerDeliveryFeeMinor,
      driverRemunerationMinor: ruleResult.rule.driverRemunerationMinor,
      customerDeliveryFeeDzd: '5,00 DZD',
      driverRemunerationDzd: '3,00 DZD',
    },
    notes: [
      'Amounts are synthetic test values, not production pricing.',
      'customerDeliveryFeeMinor=500 centimes (5,00 DZD); driverRemunerationMinor=300 centimes (3,00 DZD).',
      'No unrelated zones/rules were deactivated.',
      'Admin refresh token was not retained.',
    ],
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = join(REPORT_DIR, 'dev-checkout-fixtures-last.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log('Zone:', zoneResult.zone.id, zoneResult.created ? '(created)' : '(reused)');
  console.log('Rule:', ruleResult.rule.id, ruleResult.created ? '(created)' : '(reused)');
  console.log(
    'Fees:',
    `customerDeliveryFeeMinor=${ruleResult.rule.customerDeliveryFeeMinor} (5,00 DZD),`,
    `driverRemunerationMinor=${ruleResult.rule.driverRemunerationMinor} (3,00 DZD)`,
  );
  console.log('After:', JSON.stringify(after));
  console.log('Report:', reportPath);
  console.log('Done. Orders/redemptions unchanged by this fixture script.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
