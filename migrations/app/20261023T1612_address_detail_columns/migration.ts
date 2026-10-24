#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/9264a4ca379452b2d144241308d978ae56185d5688f82ca99bfeca30a3d68cb9/contract';
import startContract from '../../snapshots/9264a4ca379452b2d144241308d978ae56185d5688f82ca99bfeca30a3d68cb9/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ba3bdc34e4d01d7ef708da99f81d7848d454ef69d053b7e95ead4bf11ec14304/contract';
import endContract from '../../snapshots/ba3bdc34e4d01d7ef708da99f81d7848d454ef69d053b7e95ead4bf11ec14304/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'addresses',
        column: col('building', 'character varying(64)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'addresses',
        column: col('entrance', 'character varying(64)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'addresses',
        column: col('floor', 'character varying(32)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'addresses',
        column: col('landmark', 'character varying(128)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'order_delivery_address_snapshots',
        column: col('building', 'character varying(64)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'order_delivery_address_snapshots',
        column: col('entrance', 'character varying(64)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'order_delivery_address_snapshots',
        column: col('floor', 'character varying(32)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'order_delivery_address_snapshots',
        column: col('landmark', 'character varying(128)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
