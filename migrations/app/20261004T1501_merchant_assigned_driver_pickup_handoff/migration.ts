#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5a6c3e70367dbf87230bde0d8ebb24be7f3f6d4ba61a1db829c5723702299f9f/contract';
import startContract from '../../snapshots/5a6c3e70367dbf87230bde0d8ebb24be7f3f6d4ba61a1db829c5723702299f9f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/5f360a13b93c119514de0e1f92b556619f18b913fe69a50dda41fe5ca498a718/contract';
import endContract from '../../snapshots/5f360a13b93c119514de0e1f92b556619f18b913fe69a50dda41fe5ca498a718/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'delivery_pickup_handoffs',
        columns: [
          col('assignment_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('assignment_version', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('attempt_count', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('code_hash', 'character varying(128)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
          }),
          col('code_sealed', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('consumed_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('consumed_by_driver_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('created_by_account_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('delivery_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('expires_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('invalidated_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('invalidated_reason', 'character varying(64)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('locked_until', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('max_attempts', 'int4', {
            notNull: true,
            default: lit(5),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('version', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('dph_assignment_version_positive_e4eba578', 'assignment_version >= 1'),
          checkExpression('dph_attempt_count_nonneg_0b6f9474', 'attempt_count >= 0'),
          checkExpression('dph_max_attempts_positive_8cc96d9d', 'max_attempts >= 1'),
          checkExpression(
            'dph_status_values_303afc9b',
            "status IN ('PENDING', 'CONSUMED', 'INVALIDATED', 'EXPIRED', 'LOCKED')",
          ),
          checkExpression('dph_version_positive_c2490804', 'version >= 1'),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'driver_assignments',
        column: col('version', 'int4', {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'driver_assignments',
        constraint: 'driver_assignments_version_positive_c2490804',
        expression: 'version >= 1',
      }),
      this.createIndex({
        schema: 'public',
        table: 'delivery_pickup_handoffs',
        index: 'delivery_pickup_handoffs_assignment_566acae3',
        columns: ['assignment_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'delivery_pickup_handoffs',
        index: 'delivery_pickup_handoffs_delivery_37cce61e',
        columns: ['delivery_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'delivery_pickup_handoffs',
        index: 'delivery_pickup_handoffs_one_pending_per_delivery_d67328aa',
        columns: ['delivery_id'],
        extras: { where: "(status = 'PENDING')", unique: true },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'delivery_pickup_handoffs',
        foreignKey: {
          name: 'delivery_pickup_handoffs_delivery_id_fkey',
          columns: ['delivery_id'],
          references: { schema: 'public', table: 'deliveries', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
