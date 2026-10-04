#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/134bbe82722dda2d4908708df09b9028dd77cb1a57dbc6754e6d46cbb133f039/contract';
import startContract from '../../snapshots/134bbe82722dda2d4908708df09b9028dd77cb1a57dbc6754e6d46cbb133f039/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e4e4fd289e0bd24541e49e8f3017976debcc36336b4b23181952247e9ad79600/contract';
import endContract from '../../snapshots/e4e4fd289e0bd24541e49e8f3017976debcc36336b4b23181952247e9ad79600/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'commerce_verticals',
        columns: [
          col('active', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('icon_key', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('slug', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('sort_order', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('commerce_verticals_sort_nonneg_eb4b5508', 'sort_order >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_branch_classifications',
        columns: [
          col('branch_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('vertical_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_branch_covers',
        columns: [
          col('branch_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('byte_size', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('content_type', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('height_px', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('object_id', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('width_px', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('merchant_branch_covers_byte_size_pos_37df7c4a', 'byte_size > 0'),
          checkExpression('merchant_branch_covers_height_pos_194b6462', 'height_px > 0'),
          checkExpression('merchant_branch_covers_width_pos_9aff30b8', 'width_px > 0'),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'commerce_verticals',
        constraint: 'commerce_verticals_slug_key',
        columns: ['slug'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'merchant_branch_classifications',
        constraint: 'merchant_branch_classifications_branch_id_key',
        columns: ['branch_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'merchant_branch_covers',
        constraint: 'merchant_branch_covers_branch_id_key',
        columns: ['branch_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_branch_classifications',
        index: 'merchant_branch_classifications_vertical_02fccf59',
        columns: ['vertical_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branch_classifications',
        foreignKey: {
          name: 'merchant_branch_classifications_branch_id_fkey',
          columns: ['branch_id'],
          references: { schema: 'public', table: 'merchant_branches', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branch_classifications',
        foreignKey: {
          name: 'merchant_branch_classifications_vertical_id_fkey',
          columns: ['vertical_id'],
          references: { schema: 'public', table: 'commerce_verticals', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branch_covers',
        foreignKey: {
          name: 'merchant_branch_covers_branch_id_fkey',
          columns: ['branch_id'],
          references: { schema: 'public', table: 'merchant_branches', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
