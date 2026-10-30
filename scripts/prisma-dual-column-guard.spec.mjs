import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDzdConfig,
  parseDatabaseName,
  psqlConnectionUrl,
  refuseReason,
  resolveMigrateUrl,
  SHARED_MIGRATE_REFUSED,
  stripPassthrough,
} from './prisma-dual-column-guard.mjs';

test('refuses speedygo_dev even with DZD config', () => {
  const reason = refuseReason({
    command: 'migrate',
    database: 'speedygo_dev',
    dualColumn: true,
    dzdConfig: true,
    allow: true,
  });
  assert.match(reason, /speedygo_dev/);
  assert.equal(SHARED_MIGRATE_REFUSED.has('speedygo_dev'), true);
});

test('refuses BigInt migrate on dual-column promotions.value_amount', () => {
  const reason = refuseReason({
    command: 'migrate',
    database: 'speedygo_promotions_verify_probe',
    dualColumn: true,
    dzdConfig: false,
  });
  assert.match(reason, /promotions\.value/);
  assert.match(reason, /nullable=false actual=true/);
});

test('refuses DZD migrate on dual-column without explicit allow', () => {
  const reason = refuseReason({
    command: 'migrate',
    database: 'speedygo_promotions_verify_probe',
    dualColumn: true,
    dzdConfig: true,
    allow: false,
  });
  assert.match(reason, /SPEEDYGO_PRISMA_MIGRATE_ALLOW/);
});

test('does not refuse BigInt migrate on non-dual-column e2e', () => {
  const reason = refuseReason({
    command: 'migrate',
    database: 'speedygo_test',
    dualColumn: false,
    dzdConfig: false,
  });
  assert.equal(reason, null);
});

test('parses --config and --db flags', () => {
  assert.equal(isDzdConfig(['--config', 'prisma.config.dzd.ts']), true);
  assert.equal(isDzdConfig(['--config', 'prisma.config.ts']), false);
  assert.equal(
    parseDatabaseName('postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_dev'),
    'speedygo_dev',
  );
  assert.equal(
    resolveMigrateUrl(['--db', 'postgresql://localhost/probe'], {}),
    'postgresql://localhost/probe',
  );
  assert.deepEqual(
    stripPassthrough(['--', '--db', 'postgresql://localhost/probe']),
    ['--db', 'postgresql://localhost/probe'],
  );
  assert.equal(
    resolveMigrateUrl(
      stripPassthrough(['--', '--db', 'postgresql://localhost/probe']),
      {},
    ),
    'postgresql://localhost/probe',
  );
  assert.equal(
    parseDatabaseName(
      'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_dev?schema=public',
    ),
    'speedygo_dev',
  );
  assert.equal(
    psqlConnectionUrl(
      'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_dev?schema=public',
    ),
    'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_dev',
  );
});
