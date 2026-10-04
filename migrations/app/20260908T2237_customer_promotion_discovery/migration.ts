#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/411048be8dc61b0e976117b2423e1e588cbb63015b39e8bb42241e528f955c41/contract';
import endContract from '../../snapshots/411048be8dc61b0e976117b2423e1e588cbb63015b39e8bb42241e528f955c41/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e4e4fd289e0bd24541e49e8f3017976debcc36336b4b23181952247e9ad79600/contract';
import startContract from '../../snapshots/e4e4fd289e0bd24541e49e8f3017976debcc36336b4b23181952247e9ad79600/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'promotions',
        column: col('customer_discoverable', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'promotions',
        column: col('customer_label', 'character varying(64)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'promotions',
        index: 'promotions_customer_discovery_a02cab51',
        columns: ['customer_discoverable', 'active', 'ends_at'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
