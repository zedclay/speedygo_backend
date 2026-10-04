#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0cb52e95a90c362917ec313715a8fdd47c8e6e9aa723aa244a5345eaa3382154/contract';
import endContract from '../../snapshots/0cb52e95a90c362917ec313715a8fdd47c8e6e9aa723aa244a5345eaa3382154/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/94ad979be26280a01781188fa9639523c0c2fd1cfdbaa063c58a66b385eecc96/contract';
import startContract from '../../snapshots/94ad979be26280a01781188fa9639523c0c2fd1cfdbaa063c58a66b385eecc96/contract.json' with { type: 'json' };
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
        table: 'order_preparation_estimate_revisions',
        columns: [
          col('actor_account_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('add_minutes', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('new_estimated_ready_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('order_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('previous_estimated_ready_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('reason', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('revision_number', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('order_prep_estimate_revisions_add_positive_bb75bf37', 'add_minutes > 0'),
          checkExpression(
            'order_prep_estimate_revisions_rev_positive_fe94db1c',
            'revision_number > 0',
          ),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'orders',
        column: col('estimated_ready_at', 'timestamptz(6)', {
          codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'orders',
        column: col('original_estimated_ready_at', 'timestamptz(6)', {
          codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'orders',
        column: col('original_preparation_minutes', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'orders',
        column: col('preparation_estimate_version', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'orders',
        column: col('preparation_minutes', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'order_preparation_estimate_revisions',
        constraint: 'order_preparation_estimate_revisions_order_id_revision_number_key',
        columns: ['order_id', 'revision_number'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'order_preparation_estimate_revisions',
        index: 'order_prep_estimate_revisions_order_created_7a2aab70',
        columns: ['order_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'order_preparation_estimate_revisions',
        index: 'order_preparation_estimate_revisions_order_id_idx_39ad19ad',
        columns: ['order_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'order_preparation_estimate_revisions',
        foreignKey: {
          name: 'order_preparation_estimate_revisions_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
