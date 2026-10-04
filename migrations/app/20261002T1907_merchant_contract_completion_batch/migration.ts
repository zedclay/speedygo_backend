#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0cb52e95a90c362917ec313715a8fdd47c8e6e9aa723aa244a5345eaa3382154/contract';
import startContract from '../../snapshots/0cb52e95a90c362917ec313715a8fdd47c8e6e9aa723aa244a5345eaa3382154/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/8f14779ee734e1c537960d26019452073e584014cbc451a6fc0caac66b910079/contract';
import endContract from '../../snapshots/8f14779ee734e1c537960d26019452073e584014cbc451a6fc0caac66b910079/contract.json' with { type: 'json' };
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
        table: 'merchant_branch_hours_exception_intervals',
        columns: [
          col('closes_minute', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('closes_next_day', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('exception_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('opens_minute', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('sort_order', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'mbhei_closes_minute_range_bf3125d6',
            'closes_minute >= 0 AND closes_minute <= 1439',
          ),
          checkExpression(
            'mbhei_opens_minute_range_c4a5e691',
            'opens_minute >= 0 AND opens_minute <= 1439',
          ),
          checkExpression(
            'mbhei_same_day_ddcda821',
            '(closes_next_day = false AND closes_minute > opens_minute) OR (closes_next_day = true AND closes_minute = 0)',
          ),
          checkExpression('mbhei_sort_order_nonneg_eb4b5508', 'sort_order >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_branch_hours_exceptions',
        columns: [
          col('branch_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('closed', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('customer_message', 'character varying(500)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 500 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('label', 'character varying(80)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 80 } },
          }),
          col('local_date', 'date', { notNull: true, codecRef: { codecId: 'pg/date-string@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('updated_by_account_id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('version', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('mbhe_label_not_blank_69b5916b', 'length(btrim(label)) > 0'),
          checkExpression('mbhe_version_positive_c2490804', 'version >= 1'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_branch_logos',
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
          checkExpression('merchant_branch_logos_byte_size_pos_37df7c4a', 'byte_size > 0'),
          checkExpression('merchant_branch_logos_height_pos_194b6462', 'height_px > 0'),
          checkExpression('merchant_branch_logos_width_pos_9aff30b8', 'width_px > 0'),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'products',
        column: col('duplicate_request_key', 'character varying(64)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'merchant_branch_logos',
        constraint: 'merchant_branch_logos_branch_id_key',
        columns: ['branch_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'products',
        constraint: 'products_duplicate_request_key_key',
        columns: ['duplicate_request_key'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_branch_hours_exception_intervals',
        index: 'mbhei_exception_sort_6abf0a5c',
        columns: ['exception_id', 'sort_order'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_branch_hours_exception_intervals',
        index: 'merchant_branch_hours_exception_intervals_exception_id_a9e27c78',
        columns: ['exception_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_branch_hours_exceptions',
        index: 'mbhe_branch_local_date_uq_3efafeed',
        columns: ['branch_id', 'local_date'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_branch_hours_exceptions',
        index: 'merchant_branch_hours_exceptions_branch_id_idx_b5212172',
        columns: ['branch_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_branch_hours_exceptions',
        index: 'merchant_branch_hours_exceptions_updated_by_account_id_8a198d5b',
        columns: ['updated_by_account_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branch_hours_exception_intervals',
        foreignKey: {
          name: 'merchant_branch_hours_exception_intervals_exception_id_fkey',
          columns: ['exception_id'],
          references: {
            schema: 'public',
            table: 'merchant_branch_hours_exceptions',
            columns: ['id'],
          },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branch_hours_exceptions',
        foreignKey: {
          name: 'merchant_branch_hours_exceptions_branch_id_fkey',
          columns: ['branch_id'],
          references: { schema: 'public', table: 'merchant_branches', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branch_hours_exceptions',
        foreignKey: {
          name: 'merchant_branch_hours_exceptions_updated_by_account_id_fkey',
          columns: ['updated_by_account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branch_logos',
        foreignKey: {
          name: 'merchant_branch_logos_branch_id_fkey',
          columns: ['branch_id'],
          references: { schema: 'public', table: 'merchant_branches', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
