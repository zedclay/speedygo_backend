#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/62b296fbae17f35895acd11d737ea67cf46b8df6f369588290c71ce9b4457ee0/contract';
import endContract from '../../snapshots/62b296fbae17f35895acd11d737ea67cf46b8df6f369588290c71ce9b4457ee0/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/8f14779ee734e1c537960d26019452073e584014cbc451a6fc0caac66b910079/contract';
import startContract from '../../snapshots/8f14779ee734e1c537960d26019452073e584014cbc451a6fc0caac66b910079/contract.json' with { type: 'json' };
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
        table: 'legal_document_versions',
        columns: [
          col('active', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('content_sha256', 'character varying(64)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('content_url', 'character varying(512)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 512 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('effective_from', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('kind', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
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
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_legal_acceptances',
        columns: [
          col('accepted_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('account_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('kind', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('member_role', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('merchant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('submission_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('version', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_verification_issues',
        columns: [
          col('code', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('document_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('document_type', 'character varying(64)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('message_fr', 'character varying(500)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 500 } },
          }),
          col('resolved_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('scope', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('submission_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('mvi_message_not_blank_3b0d62f9', 'length(btrim(message_fr)) > 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_verification_submissions',
        columns: [
          col('attempt_number', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('outcome', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('reviewed_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('reviewed_by_admin_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('submitted_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('submitted_by_account_id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('mvs_attempt_positive_931febaa', 'attempt_number >= 1'),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'legal_document_versions',
        index: 'legal_document_versions_kind_version_uq_725d8c30',
        columns: ['kind', 'version'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_legal_acceptances',
        index: 'merchant_legal_acceptances_submission_id_idx_82020796',
        columns: ['submission_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_legal_acceptances',
        index: 'mla_merchant_92be5ce7',
        columns: ['merchant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_legal_acceptances',
        index: 'mla_submission_kind_uq_fc9908f9',
        columns: ['submission_id', 'kind'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_verification_issues',
        index: 'mvi_merchant_92be5ce7',
        columns: ['merchant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_verification_issues',
        index: 'mvi_submission_82020796',
        columns: ['submission_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_verification_submissions',
        index: 'merchant_verification_submissions_merchant_id_idx_92be5ce7',
        columns: ['merchant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_verification_submissions',
        index: 'mvs_merchant_attempt_uq_05312195',
        columns: ['merchant_id', 'attempt_number'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_verification_submissions',
        index: 'mvs_merchant_submitted_c1358413',
        columns: ['merchant_id', 'submitted_at'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_legal_acceptances',
        foreignKey: {
          name: 'merchant_legal_acceptances_merchant_id_fkey',
          columns: ['merchant_id'],
          references: { schema: 'public', table: 'merchants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_legal_acceptances',
        foreignKey: {
          name: 'merchant_legal_acceptances_submission_id_fkey',
          columns: ['submission_id'],
          references: {
            schema: 'public',
            table: 'merchant_verification_submissions',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_verification_issues',
        foreignKey: {
          name: 'merchant_verification_issues_merchant_id_fkey',
          columns: ['merchant_id'],
          references: { schema: 'public', table: 'merchants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_verification_issues',
        foreignKey: {
          name: 'merchant_verification_issues_submission_id_fkey',
          columns: ['submission_id'],
          references: {
            schema: 'public',
            table: 'merchant_verification_submissions',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_verification_submissions',
        foreignKey: {
          name: 'merchant_verification_submissions_merchant_id_fkey',
          columns: ['merchant_id'],
          references: { schema: 'public', table: 'merchants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
