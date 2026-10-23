#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1b15de73587b67f9cac7053e53d578aa2c1d217915b465f9f8f4cef9e3d5a9b7/contract';
import endContract from '../../snapshots/1b15de73587b67f9cac7053e53d578aa2c1d217915b465f9f8f4cef9e3d5a9b7/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/5f360a13b93c119514de0e1f92b556619f18b913fe69a50dda41fe5ca498a718/contract';
import startContract from '../../snapshots/5f360a13b93c119514de0e1f92b556619f18b913fe69a50dda41fe5ca498a718/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'customer_internal_notes',
        columns: [
          col('admin_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('body', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('category', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('customer_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_internal_notes',
        index: 'customer_internal_notes_admin_id_idx_78cc3551',
        columns: ['admin_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_internal_notes',
        index: 'customer_internal_notes_customer_created_cd59c338',
        columns: ['customer_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_internal_notes',
        index: 'customer_internal_notes_customer_id_idx_e16dfa6b',
        columns: ['customer_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_internal_notes',
        foreignKey: {
          name: 'customer_internal_notes_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_internal_notes',
        foreignKey: {
          name: 'customer_internal_notes_admin_id_fkey',
          columns: ['admin_id'],
          references: { schema: 'public', table: 'admin_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
