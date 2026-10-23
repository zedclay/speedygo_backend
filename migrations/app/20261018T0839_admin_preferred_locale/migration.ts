#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1b15de73587b67f9cac7053e53d578aa2c1d217915b465f9f8f4cef9e3d5a9b7/contract';
import startContract from '../../snapshots/1b15de73587b67f9cac7053e53d578aa2c1d217915b465f9f8f4cef9e3d5a9b7/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/7448b31eee80f6caa06c4efc23446ff52211ff1034480e11f63d146d7f17d49e/contract';
import endContract from '../../snapshots/7448b31eee80f6caa06c4efc23446ff52211ff1034480e11f63d146d7f17d49e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'admin_profiles',
        column: col('preferred_locale', 'character varying(8)', {
          notNull: true,
          default: lit('fr'),
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 8 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
