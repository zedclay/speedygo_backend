#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/814b83f78028a55cb5444bb79fa2f11b6a556d1b20c87e259f2ea3d2774f7ca1/contract';
import endContract from '../../snapshots/814b83f78028a55cb5444bb79fa2f11b6a556d1b20c87e259f2ea3d2774f7ca1/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a80f90422dc1c9d388e0945102991a6126096c823f2c19d4912d7a5b26fe954a/contract';
import startContract from '../../snapshots/a80f90422dc1c9d388e0945102991a6126096c823f2c19d4912d7a5b26fe954a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'refunds',
        column: col('paid_terminal_intent_key', 'character varying(128)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'refunds',
        column: col('request_origin', 'text', {
          notNull: true,
          default: lit('ADMIN'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.dropNotNull({ schema: 'public', table: 'refunds', column: 'requested_by_admin_id' }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'refunds',
        constraint: 'refunds_origin_actor_intent_ck_67637088',
        expression:
          "(request_origin = 'ADMIN' AND requested_by_admin_id IS NOT NULL AND paid_terminal_intent_key IS NULL) OR (request_origin IN ('CUSTOMER_CANCELLATION', 'MERCHANT_REJECTION', 'LATE_PAYMENT_SUCCESS') AND requested_by_admin_id IS NULL AND paid_terminal_intent_key IS NOT NULL)",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'refunds',
        constraint: 'refunds_request_origin_check_85f8868a',
        expression:
          "\"request_origin\" IN ('ADMIN', 'CUSTOMER_CANCELLATION', 'MERCHANT_REJECTION', 'LATE_PAYMENT_SUCCESS')",
      }),
      this.addUnique({
        schema: 'public',
        table: 'refunds',
        constraint: 'refunds_paid_terminal_intent_key_key',
        columns: ['paid_terminal_intent_key'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
