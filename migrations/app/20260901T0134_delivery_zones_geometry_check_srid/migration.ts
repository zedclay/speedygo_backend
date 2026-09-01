#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a8b431629c40d9058d2c34c6146ff975080866a91990492bb917c83242dd0987/contract';
import endContract from '../../snapshots/a8b431629c40d9058d2c34c6146ff975080866a91990492bb917c83242dd0987/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c50ce1572fb73e46f238f7f961da36b8c521a9a5f28d176148f0fca53e452b26/contract';
import startContract from '../../snapshots/c50ce1572fb73e46f238f7f961da36b8c521a9a5f28d176148f0fca53e452b26/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    // Restore geometry(Geometry, 4326) so the live column matches
    // postgis.Geometry(4326). Skipped when the typmod is already Geometry.
    // GIST on geometry is preserved. MultiPolygon + SRID stay CHECK-enforced.
    return [
      rawSql({
        id: 'delivery_zones.geometry.restore_geometry_4326',
        label: 'Restore delivery_zones.geometry to geometry(Geometry, 4326)',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'column',
            name: 'delivery_zones.geometry',
          },
        },
        precheck: [
          {
            description: 'pg typmod is not geometry(Geometry,4326)',
            sql: `SELECT EXISTS (
              SELECT 1
              FROM pg_attribute a
              JOIN pg_class c ON c.oid = a.attrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relname = 'delivery_zones'
                AND a.attname = 'geometry'
                AND format_type(a.atttypid, a.atttypmod) <> 'geometry(Geometry,4326)'
            ) AS "result"`,
          },
        ],
        execute: [
          {
            description: 'alter geometry to geometry(Geometry, 4326)',
            sql: `ALTER TABLE "public"."delivery_zones"
ALTER COLUMN "geometry"
TYPE geometry(Geometry, 4326)
USING "geometry"::geometry(Geometry, 4326)`,
          },
        ],
        postcheck: [
          {
            description: 'pg typmod is geometry(Geometry,4326)',
            sql: `SELECT EXISTS (
              SELECT 1
              FROM pg_attribute a
              JOIN pg_class c ON c.oid = a.attrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relname = 'delivery_zones'
                AND a.attname = 'geometry'
                AND format_type(a.atttypid, a.atttypmod) = 'geometry(Geometry,4326)'
            ) AS "result"`,
          },
        ],
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'delivery_zones',
        constraint: 'delivery_zones_geometry_multipolygon_218a73f6',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'delivery_zones',
        constraint: 'delivery_zones_geometry_multipolygon_ff825981',
        expression: "GeometryType(geometry) = 'MULTIPOLYGON' AND ST_SRID(geometry) = 4326",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
