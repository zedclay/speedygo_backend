#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2fd5cf549eac37a085fad12c750f64849efebfcc45d40e66b62fd5d4ff908939/contract';
import endContract from '../../snapshots/2fd5cf549eac37a085fad12c750f64849efebfcc45d40e66b62fd5d4ff908939/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/5245ba76c92ef21755f3c858edf5cf9a2d333d45bdf1b1c438062a6f00a4c8eb/contract';
import startContract from '../../snapshots/5245ba76c92ef21755f3c858edf5cf9a2d333d45bdf1b1c438062a6f00a4c8eb/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'communes',
        columns: [
          col('aliases_fr', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name_ar', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('name_fr', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('wilaya_code', 'character varying(2)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 2 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'wilayas',
        columns: [
          col('code', 'character varying(2)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 2 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('name_ar', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('name_fr', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['code'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'merchant_branches',
        column: col('commune_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'merchant_branches',
        column: col('wilaya_code', 'character varying(2)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 2 } },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'merchant_branches',
        constraint: 'merchant_branches_wilaya_commune_pair_b891da29',
        expression:
          '(wilaya_code IS NULL AND commune_id IS NULL) OR (wilaya_code IS NOT NULL AND commune_id IS NOT NULL)',
      }),
      this.createIndex({
        schema: 'public',
        table: 'communes',
        index: 'communes_wilaya_426d9809',
        columns: ['wilaya_code'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_branches',
        index: 'merchant_branches_commune_dd20fc21',
        columns: ['commune_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_branches',
        index: 'merchant_branches_wilaya_426d9809',
        columns: ['wilaya_code'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'communes',
        foreignKey: {
          name: 'communes_wilaya_code_fkey',
          columns: ['wilaya_code'],
          references: { schema: 'public', table: 'wilayas', columns: ['code'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branches',
        foreignKey: {
          name: 'merchant_branches_commune_id_fkey',
          columns: ['commune_id'],
          references: { schema: 'public', table: 'communes', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branches',
        foreignKey: {
          name: 'merchant_branches_wilaya_code_fkey',
          columns: ['wilaya_code'],
          references: { schema: 'public', table: 'wilayas', columns: ['code'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
