#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/a53452481d9065c8a789cce9a40ebe69c2eff6dddea17bb24a83ce533f201e2d/contract';
import startContract from '../../snapshots/a53452481d9065c8a789cce9a40ebe69c2eff6dddea17bb24a83ce533f201e2d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c50ce1572fb73e46f238f7f961da36b8c521a9a5f28d176148f0fca53e452b26/contract';
import endContract from '../../snapshots/c50ce1572fb73e46f238f7f961da36b8c521a9a5f28d176148f0fca53e452b26/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    // Applied: MultiPolygon GeometryType CHECK only. Do not re-introduce a
    // MultiPolygon typmod here — that drifted from postgis.Geometry(4326).
    // Typmod correction + ST_SRID CHECK live in a later migration.
    return [
      this.addCheckConstraint({
        schema: 'public',
        table: 'delivery_zones',
        constraint: 'delivery_zones_geometry_multipolygon_218a73f6',
        expression: "GeometryType(geometry) = 'MULTIPOLYGON'",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
