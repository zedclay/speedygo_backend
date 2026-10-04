#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/62b296fbae17f35895acd11d737ea67cf46b8df6f369588290c71ce9b4457ee0/contract';
import startContract from '../../snapshots/62b296fbae17f35895acd11d737ea67cf46b8df6f369588290c71ce9b4457ee0/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/dc7b1a4bb28ce1cc6e4a5cea5d0a41d25c795b1dc29c3593bc38969b06b7112f/contract';
import endContract from '../../snapshots/dc7b1a4bb28ce1cc6e4a5cea5d0a41d25c795b1dc29c3593bc38969b06b7112f/contract.json' with { type: 'json' };
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
        table: 'support_faq_articles',
        columns: [
          col('active', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('audience', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('body_fr', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('published_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('slug', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('sort_order', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('title_fr', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('version', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('support_faq_sort_nonneg_eb4b5508', 'sort_order >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'support_topics',
        columns: [
          col('active', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('audience', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('code', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('label_fr', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('sort_order', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('support_topics_sort_nonneg_eb4b5508', 'sort_order >= 0'),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'merchant_branches',
        column: col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'merchant_branches',
        column: col('name_ar', 'character varying(255)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'merchant_branches',
        column: col('public_email', 'character varying(255)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'products',
        column: col('selling_unit_code', 'character varying(32)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'products',
        column: col('selling_unit_label_fr', 'character varying(64)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'support_tickets',
        column: col('subject', 'character varying(255)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'support_tickets',
        column: col('topic_code', 'character varying(64)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'support_faq_articles',
        constraint: 'support_faq_articles_audience_slug_version_key',
        columns: ['audience', 'slug', 'version'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'support_topics',
        constraint: 'support_topics_code_key',
        columns: ['code'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_faq_articles',
        index: 'support_faq_audience_active_sort_cf8cd612',
        columns: ['audience', 'active', 'sort_order'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_topics',
        index: 'support_topics_audience_active_sort_cf8cd612',
        columns: ['audience', 'active', 'sort_order'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
