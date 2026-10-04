#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4ff87496744aaf2e4b631e602365bf8b1fcfded5d354185d3a6f307cf86e3f57/contract';
import startContract from '../../snapshots/4ff87496744aaf2e4b631e602365bf8b1fcfded5d354185d3a6f307cf86e3f57/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/5a6c3e70367dbf87230bde0d8ebb24be7f3f6d4ba61a1db829c5723702299f9f/contract';
import endContract from '../../snapshots/5a6c3e70367dbf87230bde0d8ebb24be7f3f6d4ba61a1db829c5723702299f9f/contract.json' with { type: 'json' };
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
        table: 'merchant_member_invitations',
        columns: [
          col('accepted_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('accepted_by_account_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('cancelled_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('created_by_account_id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('expires_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('phone', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('role', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('token_hash', 'character varying(128)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
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
          checkExpression('mmi_role_values_75886224', "role IN ('MANAGER', 'STAFF')"),
          checkExpression(
            'mmi_status_values_3b81a0af',
            "status IN ('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED')",
          ),
          checkExpression('mmi_version_positive_c2490804', 'version >= 1'),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'merchant_members',
        column: col('updated_at', 'timestamptz(6)', {
          notNull: true,
          default: fn('now()'),
          codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'merchant_members',
        column: col('version', 'int4', {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_member_invitations',
        index: 'merchant_member_invitations_accepted_by_account_id_idx_c81886a8',
        columns: ['accepted_by_account_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_member_invitations',
        index: 'merchant_member_invitations_created_by_account_id_idx_01ca7524',
        columns: ['created_by_account_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_member_invitations',
        index: 'merchant_member_invitations_merchant_id_idx_92be5ce7',
        columns: ['merchant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_member_invitations',
        index: 'mmi_merchant_phone_pending_uq_23aa45d2',
        columns: ['merchant_id', 'phone'],
        extras: { where: "(status = 'PENDING')", unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_member_invitations',
        index: 'mmi_merchant_status_06a43d97',
        columns: ['merchant_id', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_member_invitations',
        index: 'mmi_phone_status_a9012a96',
        columns: ['phone', 'status'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_member_invitations',
        foreignKey: {
          name: 'merchant_member_invitations_merchant_id_fkey',
          columns: ['merchant_id'],
          references: { schema: 'public', table: 'merchants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_member_invitations',
        foreignKey: {
          name: 'merchant_member_invitations_created_by_account_id_fkey',
          columns: ['created_by_account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_member_invitations',
        foreignKey: {
          name: 'merchant_member_invitations_accepted_by_account_id_fkey',
          columns: ['accepted_by_account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
