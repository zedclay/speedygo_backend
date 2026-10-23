#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/7448b31eee80f6caa06c4efc23446ff52211ff1034480e11f63d146d7f17d49e/contract';
import startContract from '../../snapshots/7448b31eee80f6caa06c4efc23446ff52211ff1034480e11f63d146d7f17d49e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/9264a4ca379452b2d144241308d978ae56185d5688f82ca99bfeca30a3d68cb9/contract';
import endContract from '../../snapshots/9264a4ca379452b2d144241308d978ae56185d5688f82ca99bfeca30a3d68cb9/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'refunds',
        constraint: 'refunds_request_origin_check_85f8868a',
      }),
      this.addColumn({
        schema: 'public',
        table: 'sessions',
        column: col('auth_audience', 'character varying(16)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 16 } },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'refunds',
        constraint: 'refunds_request_origin_check_8ebf7837',
        expression:
          "\"request_origin\" IN ('ADMIN', 'CUSTOMER_CANCELLATION', 'MERCHANT_REJECTION', 'LATE_PAYMENT_SUCCESS', 'ADMIN_ORDER_CANCELLATION')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
