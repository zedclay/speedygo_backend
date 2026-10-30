#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/ba3bdc34e4d01d7ef708da99f81d7848d454ef69d053b7e95ead4bf11ec14304/contract';
import startContract from '../../snapshots/ba3bdc34e4d01d7ef708da99f81d7848d454ef69d053b7e95ead4bf11ec14304/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f2f8d3dd52add96c6cd1d154f4b9dd9f2b18b394a0a878dd4e58841edaacbd3b/contract';
import endContract from '../../snapshots/f2f8d3dd52add96c6cd1d154f4b9dd9f2b18b394a0a878dd4e58841edaacbd3b/contract.json' with { type: 'json' };
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
        table: 'customer_favorites',
        columns: [
          col('branch_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('customer_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('target_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('target_kind', 'character varying(16)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 16 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'customer_favorites_kind_6a252a76',
            "target_kind IN ('BRANCH', 'PRODUCT')",
          ),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_favorites',
        index: 'customer_favorites_branch_id_idx_b5212172',
        columns: ['branch_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_favorites',
        index: 'customer_favorites_customer_created_cd59c338',
        columns: ['customer_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_favorites',
        index: 'customer_favorites_customer_id_idx_e16dfa6b',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_favorites',
        index: 'customer_favorites_owner_target_8a263e23',
        columns: ['customer_id', 'target_kind', 'target_id'],
        extras: { unique: true },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_favorites',
        foreignKey: {
          name: 'customer_favorites_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_favorites',
        foreignKey: {
          name: 'customer_favorites_branch_id_fkey',
          columns: ['branch_id'],
          references: { schema: 'public', table: 'merchant_branches', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
