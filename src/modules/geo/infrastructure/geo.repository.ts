import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import type {
  CommuneRecord,
  WilayaRecord,
} from '../domain/geo.types';

@Injectable()
export class GeoRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async listWilayas(): Promise<WilayaRecord[]> {
    const rows = await this.db()
      .orm.public.Wilaya.orderBy((w) => w.code.asc())
      .all();
    return rows.map((row) => this.toWilaya(row));
  }

  async findWilaya(code: string): Promise<WilayaRecord | null> {
    const row = await this.db()
      .orm.public.Wilaya.where({ code: pgVarchar<2>(code) })
      .first();
    return row ? this.toWilaya(row) : null;
  }

  async findCommune(id: number): Promise<CommuneRecord | null> {
    const row = await this.db().orm.public.Commune.where({ id }).first();
    return row ? this.toCommune(row) : null;
  }

  async listCommunesByWilaya(
    wilayaCode: string,
    q?: string,
  ): Promise<CommuneRecord[]> {
    const rows = await this.db()
      .orm.public.Commune.where({ wilayaCode: pgVarchar<2>(wilayaCode) })
      .orderBy((c) => c.nameFr.asc())
      .all();
    const mapped = rows.map((row) => this.toCommune(row));
    const needle = q?.trim().toLocaleLowerCase('fr-DZ');
    if (!needle) {
      return mapped;
    }
    return mapped.filter((commune) => {
      if (commune.nameFr.toLocaleLowerCase('fr-DZ').includes(needle)) {
        return true;
      }
      if (commune.nameAr.includes(q!.trim())) {
        return true;
      }
      return commune.aliasesFr.some((alias) =>
        alias.toLocaleLowerCase('fr-DZ').includes(needle),
      );
    });
  }

  async findCommunesByIds(ids: number[]): Promise<CommuneRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db()
      .orm.public.Commune.where((c) => c.id.in(ids))
      .all();
    return rows.map((row) => this.toCommune(row));
  }

  async findWilayasByCodes(codes: string[]): Promise<WilayaRecord[]> {
    if (codes.length === 0) {
      return [];
    }
    const branded = codes.map((code) => pgVarchar<2>(code));
    const rows = await this.db()
      .orm.public.Wilaya.where((w) => w.code.in(branded))
      .all();
    return rows.map((row) => this.toWilaya(row));
  }

  /** Test/helper upsert — not used by HTTP import. */
  async upsertWilaya(input: {
    code: string;
    nameFr: string;
    nameAr: string;
  }): Promise<WilayaRecord> {
    const existing = await this.findWilaya(input.code);
    const now = pgNow();
    if (existing) {
      await this.db()
        .orm.public.Wilaya.where({ code: pgVarchar<2>(input.code) })
        .update({
          nameFr: pgVarchar<255>(input.nameFr),
          nameAr: pgVarchar<255>(input.nameAr),
          updatedAt: now,
        });
      return (await this.findWilaya(input.code))!;
    }
    const created = await this.db().orm.public.Wilaya.create({
      code: pgVarchar<2>(input.code),
      nameFr: pgVarchar<255>(input.nameFr),
      nameAr: pgVarchar<255>(input.nameAr),
      createdAt: now,
      updatedAt: now,
    });
    return this.toWilaya(created);
  }

  async upsertCommune(input: {
    id: number;
    wilayaCode: string;
    nameFr: string;
    nameAr: string;
    aliasesFr?: string[] | null;
  }): Promise<CommuneRecord> {
    const existing = await this.findCommune(input.id);
    const now = pgNow();
    const aliasesFr =
      input.aliasesFr && input.aliasesFr.length > 0
        ? (JSON.parse(JSON.stringify(input.aliasesFr)) as never)
        : null;
    if (existing) {
      await this.db()
        .orm.public.Commune.where({ id: input.id })
        .update({
          wilayaCode: pgVarchar<2>(input.wilayaCode),
          nameFr: pgVarchar<255>(input.nameFr),
          nameAr: pgVarchar<255>(input.nameAr),
          aliasesFr,
          updatedAt: now,
        });
      return (await this.findCommune(input.id))!;
    }
    const created = await this.db().orm.public.Commune.create({
      id: input.id,
      wilayaCode: pgVarchar<2>(input.wilayaCode),
      nameFr: pgVarchar<255>(input.nameFr),
      nameAr: pgVarchar<255>(input.nameAr),
      aliasesFr,
      createdAt: now,
      updatedAt: now,
    });
    return this.toCommune(created);
  }

  private toWilaya(row: {
    code: string;
    nameFr: string;
    nameAr: string;
    createdAt: string;
    updatedAt: string;
  }): WilayaRecord {
    return {
      code: row.code,
      nameFr: row.nameFr,
      nameAr: row.nameAr,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toCommune(row: {
    id: number;
    wilayaCode: string;
    nameFr: string;
    nameAr: string;
    aliasesFr: unknown;
    createdAt: string;
    updatedAt: string;
  }): CommuneRecord {
    return {
      id: row.id,
      wilayaCode: row.wilayaCode,
      nameFr: row.nameFr,
      nameAr: row.nameAr,
      aliasesFr: parseAliases(row.aliasesFr),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function parseAliases(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}
