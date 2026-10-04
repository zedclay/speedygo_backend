#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4ff87496744aaf2e4b631e602365bf8b1fcfded5d354185d3a6f307cf86e3f57/contract';
import endContract from '../../snapshots/4ff87496744aaf2e4b631e602365bf8b1fcfded5d354185d3a6f307cf86e3f57/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/dc7b1a4bb28ce1cc6e4a5cea5d0a41d25c795b1dc29c3593bc38969b06b7112f/contract';
import startContract from '../../snapshots/dc7b1a4bb28ce1cc6e4a5cea5d0a41d25c795b1dc29c3593bc38969b06b7112f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'order_cancellations',
        column: col('reason_code', 'character varying(64)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'order_cancellations',
        constraint: 'order_cancellations_reason_code_values_1be6ec5c',
        expression:
          "reason_code IS NULL OR reason_code IN ('PRODUCT_UNAVAILABLE', 'TOO_BUSY', 'CLOSING_SOON', 'OTHER')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
