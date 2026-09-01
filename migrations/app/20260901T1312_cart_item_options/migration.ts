#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a80f90422dc1c9d388e0945102991a6126096c823f2c19d4912d7a5b26fe954a/contract';
import endContract from '../../snapshots/a80f90422dc1c9d388e0945102991a6126096c823f2c19d4912d7a5b26fe954a/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a8b431629c40d9058d2c34c6146ff975080866a91990492bb917c83242dd0987/contract';
import startContract from '../../snapshots/a8b431629c40d9058d2c34c6146ff975080866a91990492bb917c83242dd0987/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'cart_item_options',
        columns: [
          col('cart_item_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('product_option_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'cart_item_options',
        index: 'cart_item_options_cart_item_bdbddba5',
        columns: ['cart_item_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'cart_item_options',
        index: 'cart_item_options_item_option_uq_17bcb74b',
        columns: ['cart_item_id', 'product_option_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'cart_item_options',
        index: 'cart_item_options_option_f6695073',
        columns: ['product_option_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'cart_item_options',
        foreignKey: {
          name: 'cart_item_options_cart_item_id_fkey',
          columns: ['cart_item_id'],
          references: { schema: 'public', table: 'cart_items', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'cart_item_options',
        foreignKey: {
          name: 'cart_item_options_product_option_id_fkey',
          columns: ['product_option_id'],
          references: { schema: 'public', table: 'product_options', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
