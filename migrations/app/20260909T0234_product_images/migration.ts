#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/411048be8dc61b0e976117b2423e1e588cbb63015b39e8bb42241e528f955c41/contract';
import startContract from '../../snapshots/411048be8dc61b0e976117b2423e1e588cbb63015b39e8bb42241e528f955c41/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/5245ba76c92ef21755f3c858edf5cf9a2d333d45bdf1b1c438062a6f00a4c8eb/contract';
import endContract from '../../snapshots/5245ba76c92ef21755f3c858edf5cf9a2d333d45bdf1b1c438062a6f00a4c8eb/contract.json' with { type: 'json' };
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
        table: 'product_images',
        columns: [
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
          col('product_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('width_px', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('product_images_byte_size_pos_37df7c4a', 'byte_size > 0'),
          checkExpression('product_images_height_pos_194b6462', 'height_px > 0'),
          checkExpression('product_images_width_pos_9aff30b8', 'width_px > 0'),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'product_images',
        constraint: 'product_images_product_id_key',
        columns: ['product_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_images',
        foreignKey: {
          name: 'product_images_product_id_fkey',
          columns: ['product_id'],
          references: { schema: 'public', table: 'products', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
