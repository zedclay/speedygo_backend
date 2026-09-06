#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/134bbe82722dda2d4908708df09b9028dd77cb1a57dbc6754e6d46cbb133f039/contract';
import endContract from '../../snapshots/134bbe82722dda2d4908708df09b9028dd77cb1a57dbc6754e6d46cbb133f039/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/814b83f78028a55cb5444bb79fa2f11b6a556d1b20c87e259f2ea3d2774f7ca1/contract';
import startContract from '../../snapshots/814b83f78028a55cb5444bb79fa2f11b6a556d1b20c87e259f2ea3d2774f7ca1/contract.json' with { type: 'json' };
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
        table: 'merchant_branch_opening_intervals',
        columns: [
          col('closes_minute', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('closes_next_day', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('day_of_week', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('opens_minute', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('schedule_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('sort_order', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'mboi_closes_minute_range_bf3125d6',
            'closes_minute >= 0 AND closes_minute <= 1439',
          ),
          checkExpression(
            'mboi_day_of_week_range_90497d90',
            'day_of_week >= 1 AND day_of_week <= 7',
          ),
          checkExpression(
            'mboi_interval_duration_3dca9e58',
            '(closes_next_day = false AND closes_minute > opens_minute) OR (closes_next_day = true AND ((1440 - opens_minute) + closes_minute) > 0 AND ((1440 - opens_minute) + closes_minute) <= 1440)',
          ),
          checkExpression(
            'mboi_opens_minute_range_c4a5e691',
            'opens_minute >= 0 AND opens_minute <= 1439',
          ),
          checkExpression('mboi_sort_order_nonneg_eb4b5508', 'sort_order >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_branch_opening_schedules',
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
          col('updated_by_account_id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('version', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('mbos_version_positive_c2490804', 'version >= 1'),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'merchant_branch_opening_schedules',
        constraint: 'merchant_branch_opening_schedules_branch_id_key',
        columns: ['branch_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_branch_opening_intervals',
        index: 'mboi_schedule_day_sort_42d2d4fd',
        columns: ['schedule_id', 'day_of_week', 'sort_order'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_branch_opening_intervals',
        index: 'merchant_branch_opening_intervals_schedule_id_idx_83757f9e',
        columns: ['schedule_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_branch_opening_schedules',
        index: 'merchant_branch_opening_schedules_updated_by_account_i_8a198d5b',
        columns: ['updated_by_account_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branch_opening_intervals',
        foreignKey: {
          name: 'merchant_branch_opening_intervals_schedule_id_fkey',
          columns: ['schedule_id'],
          references: {
            schema: 'public',
            table: 'merchant_branch_opening_schedules',
            columns: ['id'],
          },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branch_opening_schedules',
        foreignKey: {
          name: 'merchant_branch_opening_schedules_branch_id_fkey',
          columns: ['branch_id'],
          references: { schema: 'public', table: 'merchant_branches', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branch_opening_schedules',
        foreignKey: {
          name: 'merchant_branch_opening_schedules_updated_by_account_id_fkey',
          columns: ['updated_by_account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
