#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2fd5cf549eac37a085fad12c750f64849efebfcc45d40e66b62fd5d4ff908939/contract';
import startContract from '../../snapshots/2fd5cf549eac37a085fad12c750f64849efebfcc45d40e66b62fd5d4ff908939/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/94ad979be26280a01781188fa9639523c0c2fd1cfdbaa063c58a66b385eecc96/contract';
import endContract from '../../snapshots/94ad979be26280a01781188fa9639523c0c2fd1cfdbaa063c58a66b385eecc96/contract.json' with { type: 'json' };
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
        table: 'merchant_branch_availability_overrides',
        columns: [
          col('branch_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('closed_until', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('customer_message', 'character varying(500)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 500 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('mode', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('reason_code', 'character varying(64)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
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
          checkExpression(
            'mbao_closed_until_mode_079d398c',
            "(mode = 'TEMPORARY_CLOSED' AND closed_until IS NOT NULL) OR (mode <> 'TEMPORARY_CLOSED' AND closed_until IS NULL)",
          ),
          checkExpression(
            'mbao_mode_values_59a9f76d',
            "mode IN ('FOLLOW_SCHEDULE', 'FORCE_CLOSED', 'TEMPORARY_CLOSED')",
          ),
          checkExpression(
            'mbao_reason_code_values_b7b54cfc',
            "reason_code IS NULL OR reason_code IN ('PEAK_KITCHEN', 'TECHNICAL', 'OUT_OF_STOCK', 'LUNCH_BREAK', 'OTHER')",
          ),
          checkExpression('mbao_version_positive_c2490804', 'version >= 1'),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'merchant_branch_availability_overrides',
        constraint: 'merchant_branch_availability_overrides_branch_id_key',
        columns: ['branch_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_branch_availability_overrides',
        index: 'merchant_branch_availability_overrides_updated_by_acco_8a198d5b',
        columns: ['updated_by_account_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branch_availability_overrides',
        foreignKey: {
          name: 'merchant_branch_availability_overrides_branch_id_fkey',
          columns: ['branch_id'],
          references: { schema: 'public', table: 'merchant_branches', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branch_availability_overrides',
        foreignKey: {
          name: 'merchant_branch_availability_overrides_updated_by_account_id_fkey',
          columns: ['updated_by_account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
