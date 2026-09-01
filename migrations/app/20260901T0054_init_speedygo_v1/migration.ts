#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a53452481d9065c8a789cce9a40ebe69c2eff6dddea17bb24a83ce533f201e2d/contract';
import endContract from '../../snapshots/a53452481d9065c8a789cce9a40ebe69c2eff6dddea17bb24a83ce533f201e2d/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'accounts',
        columns: [
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('email', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('phone', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'addresses',
        columns: [
          col('address_text', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('customer_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('is_default', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('label', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('latitude', 'numeric(9,6)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 9, scale: 6 } },
          }),
          col('longitude', 'numeric(9,6)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 9, scale: 6 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'admin_profiles',
        columns: [
          col('account_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('display_name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('role_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('two_factor_enabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'audit_logs',
        columns: [
          col('action', 'character varying(128)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
          }),
          col('admin_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('after_json', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('before_json', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('ip_address', 'inet', { codecRef: { codecId: 'pg/inet@1' } }),
          col('session_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('target_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('target_type', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'cart_items',
        columns: [
          col('cart_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('product_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('quantity', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('unit_price_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('cart_items_quantity_positive_4402679f', 'quantity > 0'),
          checkExpression('cart_items_unit_price_nonneg_443a9946', 'unit_price_minor >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'carts',
        columns: [
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('customer_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_branch_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'carts_status_check_ad7da9b8',
            "\"status\" IN ('ACTIVE', 'ABANDONED', 'CONVERTED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'categories',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_branch_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('sort_order', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'cod_collections',
        columns: [
          col('collected_amount_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('collected_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('driver_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('expected_amount_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('order_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'cod_collections_collected_nonneg_109121d3',
            'collected_amount_minor >= 0',
          ),
          checkExpression('cod_collections_expected_nonneg_d9c3774e', 'expected_amount_minor >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'cod_discrepancies',
        columns: [
          col('cause', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('confirmed_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('difference_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('driver_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('expected_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('remittance_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('resolution', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resolved_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('cod_discrepancies_confirmed_nonneg_bc87407e', 'confirmed_minor >= 0'),
          checkExpression('cod_discrepancies_expected_nonneg_840315a9', 'expected_minor >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'cod_remittance_allocations',
        columns: [
          col('allocated_amount_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('collection_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('remittance_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('cod_alloc_amount_positive_27961446', 'allocated_amount_minor > 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'cod_remittances',
        columns: [
          col('confirmed_amount_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('confirmed_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('driver_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('proof_url', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reference', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('submitted_amount_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('submitted_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'cod_remittances_confirmed_nonneg_da94b438',
            'confirmed_amount_minor >= 0',
          ),
          checkExpression(
            'cod_remittances_submitted_nonneg_ac1f18fb',
            'submitted_amount_minor >= 0',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_profiles',
        columns: [
          col('account_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('avatar_url', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('full_name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'deliveries',
        columns: [
          col('arrived_customer_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('delivered_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('driver_search_started_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('estimated_arrival_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('order_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('picked_up_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'deliveries_status_check_61debacd',
            "\"status\" IN ('SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'TO_PICKUP', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_CUSTOMER', 'DELIVERED', 'FAILED', 'CANCELLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'delivery_events',
        columns: [
          col('delivery_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('driver_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('metadata_json', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('occurred_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('type', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'delivery_pricing_rules',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('customer_delivery_fee_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('driver_remuneration_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('effective_from', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('effective_to', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('end_local_time', 'time', { codecRef: { codecId: 'pg/time-string@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('start_local_time', 'time', { codecRef: { codecId: 'pg/time-string@1' } }),
          col('time_band', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('zone_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'delivery_pricing_rules_fee_nonneg_4f0da876',
            'customer_delivery_fee_minor >= 0',
          ),
          checkExpression(
            'delivery_pricing_rules_pay_nonneg_5c839068',
            'driver_remuneration_minor >= 0',
          ),
          checkExpression(
            'delivery_pricing_rules_range_bea649da',
            'effective_to IS NULL OR effective_to > effective_from',
          ),
          checkExpression(
            'delivery_pricing_rules_time_band_check_a9a076d4',
            "\"time_band\" IN ('DAY', 'NIGHT', 'CUSTOM')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'delivery_proofs',
        columns: [
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('delivery_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('delivery_pin_hash', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('proof_image_url', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('verified_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'delivery_zones',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('geometry', 'geometry(Geometry,4326)', {
            notNull: true,
            codecRef: { codecId: 'pg/geometry@1', typeParams: { srid: 4326 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'device_tokens',
        columns: [
          col('account_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('device_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('platform', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('token', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'devices',
        columns: [
          col('account_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('app_version', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('device_name', 'character varying(128)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('last_seen_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('platform', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'driver_assignments',
        columns: [
          col('accepted_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('assigned_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('delivery_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('driver_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('released_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'driver_availability',
        columns: [
          col('current_zone_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('driver_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('offline_after_current_delivery', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['driver_id']),
          checkExpression(
            'driver_availability_status_check_98d29be1',
            "\"status\" IN ('OFFLINE', 'ONLINE', 'OFFLINE_AFTER_CURRENT_DELIVERY', 'SUSPENDED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'driver_documents',
        columns: [
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('driver_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('expiry_date', 'date', { codecRef: { codecId: 'pg/date-string@1' } }),
          col('file_url', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('type', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'driver_earnings',
        columns: [
          col('adjustment_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('base_remuneration_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('bonus_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('delivery_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('driver_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('net_earning_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('validated_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('driver_earnings_base_nonneg_77581de3', 'base_remuneration_minor >= 0'),
          checkExpression('driver_earnings_bonus_nonneg_377ba36d', 'bonus_minor >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'driver_profiles',
        columns: [
          col('account_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('approved_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('full_name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('verification_status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'driver_ratings',
        columns: [
          col('comment', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('customer_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('driver_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('order_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('score', 'int2', { notNull: true, codecRef: { codecId: 'pg/int2@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('driver_ratings_score_range_b9677a20', 'score >= 1 AND score <= 5'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'financial_ledger_entries',
        columns: [
          col('amount_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('currency', 'character(3)', {
            notNull: true,
            codecRef: { codecId: 'sql/char@1', typeParams: { length: 3 } },
          }),
          col('direction', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('driver_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('order_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('reference', 'character varying(128)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
          }),
          col('reversal_of_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('type', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('financial_ledger_entries_amount_nonneg_062058f6', 'amount_minor >= 0'),
          checkExpression(
            'financial_ledger_entries_direction_check_e2bfd96c',
            "\"direction\" IN ('DEBIT', 'CREDIT')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_branches',
        columns: [
          col('address_text', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('latitude', 'numeric(9,6)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 9, scale: 6 } },
          }),
          col('longitude', 'numeric(9,6)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 9, scale: 6 } },
          }),
          col('merchant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('operational_status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('phone', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_commission_rules',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('change_reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('changed_by_admin_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('effective_from', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('effective_to', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('rate_bps', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('scope', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'merchant_commission_rules_range_bea649da',
            'effective_to IS NULL OR effective_to > effective_from',
          ),
          checkExpression(
            'merchant_commission_rules_rate_bps_863589ea',
            'rate_bps >= 0 AND rate_bps <= 10000',
          ),
          checkExpression(
            'merchant_commission_rules_scope_check_43193bfb',
            "\"scope\" IN ('GLOBAL_DEFAULT', 'MERCHANT_OVERRIDE')",
          ),
          checkExpression(
            'merchant_commission_rules_scope_merchant_f0a645cc',
            "(scope = 'GLOBAL_DEFAULT' AND merchant_id IS NULL) OR (scope = 'MERCHANT_OVERRIDE' AND merchant_id IS NOT NULL)",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_documents',
        columns: [
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('expiry_date', 'date', { codecRef: { codecId: 'pg/date-string@1' } }),
          col('file_url', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('type', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_members',
        columns: [
          col('account_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('role', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_ratings',
        columns: [
          col('comment', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('customer_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('order_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('score', 'int2', { notNull: true, codecRef: { codecId: 'pg/int2@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('merchant_ratings_score_range_b9677a20', 'score >= 1 AND score <= 5'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_settlement_lines',
        columns: [
          col('adjustment_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('commission_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('gross_merchandise_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_net_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('order_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('reference', 'character varying(128)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
          }),
          col('settlement_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'merchant_settlement_lines_type_check_2eb331b2',
            "\"type\" IN ('SALE', 'REFUND_ADJUSTMENT', 'MANUAL_ADJUSTMENT', 'REVERSAL')",
          ),
          checkExpression('msl_commission_nonneg_335b2622', 'commission_minor >= 0'),
          checkExpression('msl_gms_nonneg_dd7d91e2', 'gross_merchandise_minor >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchant_settlements',
        columns: [
          col('commission_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('gross_sales_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('manual_adjustments_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('merchant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('net_payable_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('paid_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('period_end', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('period_start', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('refund_adjustments_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'merchant_settlements_commission_nonneg_335b2622',
            'commission_minor >= 0',
          ),
          checkExpression('merchant_settlements_gms_nonneg_1eb15619', 'gross_sales_minor >= 0'),
          checkExpression('merchant_settlements_period_ba8df753', 'period_end > period_start'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'merchants',
        columns: [
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('public_reference', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('verified_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'notification_delivery_logs',
        columns: [
          col('channel', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('notification_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('provider_reference', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('sent_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'notification_templates',
        columns: [
          col('active', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('audience', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('body_template', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('channel', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('code', 'character varying(128)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('title_template', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('trigger', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'notifications',
        columns: [
          col('account_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('body', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('category', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('read', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('template_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'order_cancellations',
        columns: [
          col('cancelled_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('cancelled_by_account_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('internal_note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('order_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('reason', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'order_delivery_address_snapshots',
        columns: [
          col('address_text', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('instructions', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('latitude', 'numeric(9,6)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 9, scale: 6 } },
          }),
          col('longitude', 'numeric(9,6)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 9, scale: 6 } },
          }),
          col('order_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['order_id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'order_financial_snapshots',
        columns: [
          col('commission_base_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('commission_rule_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('currency', 'character(3)', {
            notNull: true,
            codecRef: { codecId: 'sql/char@1', typeParams: { length: 3 } },
          }),
          col('customer_delivery_fee_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('customer_payable_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('driver_remuneration_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('gross_merchandise_subtotal_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('merchant_commission_amount_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('merchant_commission_rate_bps', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('merchant_discount_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('merchant_net_amount_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('order_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('platform_discount_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('pricing_rule_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('service_fee_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('speedygo_delivery_share_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('total_discount_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
        ],
        constraints: [
          primaryKey(['order_id']),
          checkExpression(
            'ofs_commission_amount_nonneg_8792f0d2',
            'merchant_commission_amount_minor >= 0',
          ),
          checkExpression('ofs_commission_base_nonneg_9c7def44', 'commission_base_minor >= 0'),
          checkExpression(
            'ofs_commission_rate_bps_2a89a5cd',
            'merchant_commission_rate_bps >= 0 AND merchant_commission_rate_bps <= 10000',
          ),
          checkExpression('ofs_customer_payable_nonneg_1e1632c3', 'customer_payable_minor >= 0'),
          checkExpression('ofs_delivery_fee_nonneg_4f0da876', 'customer_delivery_fee_minor >= 0'),
          checkExpression(
            'ofs_delivery_share_nonneg_9edde46c',
            'speedygo_delivery_share_minor >= 0',
          ),
          checkExpression('ofs_driver_pay_nonneg_5c839068', 'driver_remuneration_minor >= 0'),
          checkExpression('ofs_gms_nonneg_a8fcf4b0', 'gross_merchandise_subtotal_minor >= 0'),
          checkExpression('ofs_merchant_discount_nonneg_38a5b396', 'merchant_discount_minor >= 0'),
          checkExpression('ofs_merchant_net_nonneg_da8d31b3', 'merchant_net_amount_minor >= 0'),
          checkExpression('ofs_platform_discount_nonneg_437f4262', 'platform_discount_minor >= 0'),
          checkExpression('ofs_service_fee_nonneg_97c2bf1e', 'service_fee_minor >= 0'),
          checkExpression('ofs_total_discount_nonneg_e54b284a', 'total_discount_minor >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'order_item_options',
        columns: [
          col('additional_price_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('option_name_snapshot', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('order_item_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'order_item_options_price_nonneg_cc1a4a13',
            'additional_price_minor >= 0',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'order_items',
        columns: [
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('line_total_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('order_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('product_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('product_name_snapshot', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('quantity', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('unit_price_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('order_items_line_total_nonneg_293c44d3', 'line_total_minor >= 0'),
          checkExpression('order_items_quantity_positive_4402679f', 'quantity > 0'),
          checkExpression('order_items_unit_price_nonneg_443a9946', 'unit_price_minor >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'order_status_events',
        columns: [
          col('actor_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('actor_type', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('event_type', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('from_status', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('metadata_json', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('occurred_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('order_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('to_status', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'orders',
        columns: [
          col('completed_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('confirmed_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('customer_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('delivery_zone_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('fulfillment_status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_branch_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('public_reference', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'orders_fulfillment_status_check_e13af6af',
            "\"fulfillment_status\" IN ('PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'READY')",
          ),
          checkExpression(
            'orders_status_check_b1f8fb0f',
            "\"status\" IN ('CREATED', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'FAILED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'payment_transactions',
        columns: [
          col('amount_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('idempotency_key', 'character varying(128)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
          }),
          col('payment_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('processed_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('provider', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('provider_reference', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('payment_transactions_amount_nonneg_062058f6', 'amount_minor >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'payments',
        columns: [
          col('amount_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('currency', 'character(3)', {
            notNull: true,
            codecRef: { codecId: 'sql/char@1', typeParams: { length: 3 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('method', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('order_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('payments_amount_nonneg_062058f6', 'amount_minor >= 0'),
          checkExpression(
            'payments_status_check_264bdee5',
            "\"status\" IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'permissions',
        columns: [
          col('code', 'character varying(128)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'platform_settings',
        columns: [
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('key', 'character varying(128)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('updated_by_admin_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('value_json', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'product_option_groups',
        columns: [
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('max_selections', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('min_selections', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('product_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('required', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'product_option_groups_max_gte_min_9c0525aa',
            'max_selections >= min_selections',
          ),
          checkExpression('product_option_groups_min_nonneg_0e76435e', 'min_selections >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'product_options',
        columns: [
          col('additional_price_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('available', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('option_group_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('product_options_price_nonneg_cc1a4a13', 'additional_price_minor >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'products',
        columns: [
          col('available', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('category_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_branch_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('price_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('products_price_nonneg_571df5b6', 'price_minor >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'promotion_redemptions',
        columns: [
          col('customer_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('discount_amount_minor', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('funded_by', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('order_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('promotion_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('redeemed_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'promotion_redemptions_discount_nonneg_cecd5e47',
            'discount_amount_minor >= 0',
          ),
          checkExpression(
            'promotion_redemptions_funded_by_check_f385ca20',
            "\"funded_by\" IN ('SPEEDYGO', 'MERCHANT', 'SHARED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'promotions',
        columns: [
          col('active', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('code', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('ends_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('starts_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('type', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('value', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('promotions_window_30314b5b', 'ends_at > starts_at'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'refunds',
        columns: [
          col('amount_minor', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('completed_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('internal_note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('order_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('payment_transaction_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('reason', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('refund_method', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('requested_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('requested_by_admin_id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('refunds_amount_positive_6a9648c5', 'amount_minor > 0'),
          checkExpression(
            'refunds_refund_method_check_4492fbdf',
            "\"refund_method\" IN ('ORIGINAL_PAYMENT', 'MANUAL_COD', 'MANUAL_OTHER')",
          ),
          checkExpression(
            'refunds_status_check_d0d261f0',
            "\"status\" IN ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'REFUNDED', 'REJECTED', 'FAILED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'role_permissions',
        columns: [
          col('permission_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('role_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['role_id', 'permission_id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'roles',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'character varying(128)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'sessions',
        columns: [
          col('account_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('device_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('expires_at', 'timestamptz(6)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('ip_address', 'inet', { codecRef: { codecId: 'pg/inet@1' } }),
          col('refresh_token_hash', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('revoked_at', 'timestamptz(6)', {
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'support_internal_notes',
        columns: [
          col('admin_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('body', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('ticket_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'support_messages',
        columns: [
          col('author_account_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('body', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('ticket_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'support_tickets',
        columns: [
          col('assigned_admin_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('created_by_account_id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('driver_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('merchant_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('order_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('priority', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('public_reference', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'vehicles',
        columns: [
          col('color', 'character varying(64)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('created_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
          col('driver_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('model', 'character varying(128)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 128 } },
          }),
          col('plate_number', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('status', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('type', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('updated_at', 'timestamptz(6)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1', typeParams: { precision: 6 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'admin_profiles',
        constraint: 'admin_profiles_account_id_key',
        columns: ['account_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'cod_collections',
        constraint: 'cod_collections_order_id_key',
        columns: ['order_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'cod_discrepancies',
        constraint: 'cod_discrepancies_remittance_id_key',
        columns: ['remittance_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'cod_remittances',
        constraint: 'cod_remittances_reference_key',
        columns: ['reference'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'customer_profiles',
        constraint: 'customer_profiles_account_id_key',
        columns: ['account_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'deliveries',
        constraint: 'deliveries_order_id_key',
        columns: ['order_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'delivery_proofs',
        constraint: 'delivery_proofs_delivery_id_key',
        columns: ['delivery_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'device_tokens',
        constraint: 'device_tokens_token_key',
        columns: ['token'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'driver_earnings',
        constraint: 'driver_earnings_delivery_id_key',
        columns: ['delivery_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'driver_profiles',
        constraint: 'driver_profiles_account_id_key',
        columns: ['account_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'merchants',
        constraint: 'merchants_public_reference_key',
        columns: ['public_reference'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'notification_templates',
        constraint: 'notification_templates_code_key',
        columns: ['code'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'order_cancellations',
        constraint: 'order_cancellations_order_id_key',
        columns: ['order_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'orders',
        constraint: 'orders_public_reference_key',
        columns: ['public_reference'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'payment_transactions',
        constraint: 'payment_transactions_idempotency_key_key',
        columns: ['idempotency_key'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'payments',
        constraint: 'payments_order_id_key',
        columns: ['order_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'permissions',
        constraint: 'permissions_code_key',
        columns: ['code'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'platform_settings',
        constraint: 'platform_settings_key_key',
        columns: ['key'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'promotions',
        constraint: 'promotions_code_key',
        columns: ['code'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'roles',
        constraint: 'roles_name_key',
        columns: ['name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sessions',
        constraint: 'sessions_refresh_token_hash_key',
        columns: ['refresh_token_hash'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'support_tickets',
        constraint: 'support_tickets_public_reference_key',
        columns: ['public_reference'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'accounts',
        index: 'accounts_email_uq_7d2a8d5d',
        columns: ['email'],
        extras: { where: '(email IS NOT NULL)', unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'accounts',
        index: 'accounts_phone_uq_dcd11892',
        columns: ['phone'],
        extras: { where: '(phone IS NOT NULL)', unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'addresses',
        index: 'addresses_customer_e16dfa6b',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'addresses',
        index: 'addresses_one_default_per_customer_d4e4c2d0',
        columns: ['customer_id'],
        extras: { where: '(is_default)', unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'admin_profiles',
        index: 'admin_profiles_role_id_idx_d9467c50',
        columns: ['role_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audit_logs',
        index: 'audit_logs_admin_created_93cb1a5c',
        columns: ['admin_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audit_logs',
        index: 'audit_logs_admin_id_idx_78cc3551',
        columns: ['admin_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audit_logs',
        index: 'audit_logs_created_225d8c0f',
        columns: ['created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audit_logs',
        index: 'audit_logs_target_792315bb',
        columns: ['target_type', 'target_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'cart_items',
        index: 'cart_items_cart_0b3cd05c',
        columns: ['cart_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'cart_items',
        index: 'cart_items_product_id_idx_22a2b7d2',
        columns: ['product_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'carts',
        index: 'carts_customer_e16dfa6b',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'carts',
        index: 'carts_merchant_branch_id_idx_23608f05',
        columns: ['merchant_branch_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'carts',
        index: 'carts_one_active_per_customer_330fd77c',
        columns: ['customer_id'],
        extras: { where: "(status = 'ACTIVE')", unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'categories',
        index: 'categories_branch_sort_bb0804f5',
        columns: ['merchant_branch_id', 'sort_order'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'categories',
        index: 'categories_merchant_branch_id_idx_23608f05',
        columns: ['merchant_branch_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'cod_collections',
        index: 'cod_collections_driver_id_idx_56c848ae',
        columns: ['driver_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'cod_collections',
        index: 'cod_collections_driver_status_fd70f38e',
        columns: ['driver_id', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'cod_discrepancies',
        index: 'cod_discrepancies_driver_id_idx_56c848ae',
        columns: ['driver_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'cod_remittance_allocations',
        index: 'cod_alloc_remittance_collection_34021f2c',
        columns: ['remittance_id', 'collection_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'cod_remittance_allocations',
        index: 'cod_remittance_allocations_collection_2151ded8',
        columns: ['collection_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'cod_remittance_allocations',
        index: 'cod_remittance_allocations_remittance_id_idx_ee878e27',
        columns: ['remittance_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'cod_remittances',
        index: 'cod_remittances_driver_id_idx_56c848ae',
        columns: ['driver_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'cod_remittances',
        index: 'cod_remittances_driver_status_fd70f38e',
        columns: ['driver_id', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'deliveries',
        index: 'deliveries_status_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'delivery_events',
        index: 'delivery_events_delivery_id_idx_37cce61e',
        columns: ['delivery_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'delivery_events',
        index: 'delivery_events_delivery_occurred_af09dac2',
        columns: ['delivery_id', 'occurred_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'delivery_events',
        index: 'delivery_events_driver_id_idx_56c848ae',
        columns: ['driver_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'delivery_pricing_rules',
        index: 'delivery_pricing_rules_zone_band_active_50dcb31d',
        columns: ['zone_id', 'time_band', 'active'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'delivery_pricing_rules',
        index: 'delivery_pricing_rules_zone_from_a6cdb881',
        columns: ['zone_id', 'effective_from'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'delivery_pricing_rules',
        index: 'delivery_pricing_rules_zone_id_idx_45a31d4e',
        columns: ['zone_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'delivery_zones',
        index: 'delivery_zones_geometry_gist_9b4d570d',
        columns: ['geometry'],
        extras: { type: 'gist' },
      }),
      this.createIndex({
        schema: 'public',
        table: 'device_tokens',
        index: 'device_tokens_account_active_f39086ec',
        columns: ['account_id'],
        extras: { where: '(active)' },
      }),
      this.createIndex({
        schema: 'public',
        table: 'device_tokens',
        index: 'device_tokens_one_active_per_device_79a50acd',
        columns: ['device_id'],
        extras: { where: '(active AND device_id IS NOT NULL)', unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'devices',
        index: 'devices_account_id_idx_3b48271c',
        columns: ['account_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'devices',
        index: 'devices_account_last_seen_1af93c59',
        columns: ['account_id', 'last_seen_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_assignments',
        index: 'driver_assignments_delivery_37cce61e',
        columns: ['delivery_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_assignments',
        index: 'driver_assignments_driver_assigned_7a3f65f4',
        columns: ['driver_id', 'assigned_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_assignments',
        index: 'driver_assignments_one_open_per_delivery_b986850f',
        columns: ['delivery_id'],
        extras: { where: '(released_at IS NULL)', unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_assignments',
        index: 'driver_assignments_one_open_per_driver_f02783b3',
        columns: ['driver_id'],
        extras: { where: '(released_at IS NULL)', unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_availability',
        index: 'driver_availability_current_zone_id_idx_74c8b9e1',
        columns: ['current_zone_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_availability',
        index: 'driver_availability_status_zone_43278dd6',
        columns: ['status', 'current_zone_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_documents',
        index: 'driver_documents_driver_56c848ae',
        columns: ['driver_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_earnings',
        index: 'driver_earnings_driver_created_562a2b3d',
        columns: ['driver_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_earnings',
        index: 'driver_earnings_driver_id_idx_56c848ae',
        columns: ['driver_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_ratings',
        index: 'driver_ratings_customer_id_idx_e16dfa6b',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_ratings',
        index: 'driver_ratings_driver_created_562a2b3d',
        columns: ['driver_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_ratings',
        index: 'driver_ratings_driver_id_idx_56c848ae',
        columns: ['driver_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_ratings',
        index: 'driver_ratings_order_customer_6c831803',
        columns: ['order_id', 'customer_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'driver_ratings',
        index: 'driver_ratings_order_id_idx_39ad19ad',
        columns: ['order_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'financial_ledger_entries',
        index: 'financial_ledger_entries_created_225d8c0f',
        columns: ['created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'financial_ledger_entries',
        index: 'financial_ledger_entries_driver_created_562a2b3d',
        columns: ['driver_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'financial_ledger_entries',
        index: 'financial_ledger_entries_driver_id_idx_56c848ae',
        columns: ['driver_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'financial_ledger_entries',
        index: 'financial_ledger_entries_merchant_created_515bf5d4',
        columns: ['merchant_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'financial_ledger_entries',
        index: 'financial_ledger_entries_merchant_id_idx_92be5ce7',
        columns: ['merchant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'financial_ledger_entries',
        index: 'financial_ledger_entries_order_39ad19ad',
        columns: ['order_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'financial_ledger_entries',
        index: 'financial_ledger_entries_reversal_of_id_idx_ae83e631',
        columns: ['reversal_of_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'financial_ledger_entries',
        index: 'financial_ledger_entries_type_created_4eec2ffa',
        columns: ['type', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_branches',
        index: 'merchant_branches_merchant_92be5ce7',
        columns: ['merchant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_commission_rules',
        index: 'merchant_commission_rules_changed_by_admin_id_idx_69d8d226',
        columns: ['changed_by_admin_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_commission_rules',
        index: 'merchant_commission_rules_merchant_from_ad259a4f',
        columns: ['merchant_id', 'effective_from'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_commission_rules',
        index: 'merchant_commission_rules_merchant_id_idx_92be5ce7',
        columns: ['merchant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_commission_rules',
        index: 'merchant_commission_rules_scope_active_from_e3656b2c',
        columns: ['scope', 'active', 'effective_from'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_documents',
        index: 'merchant_documents_merchant_id_idx_92be5ce7',
        columns: ['merchant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_members',
        index: 'merchant_members_account_3b48271c',
        columns: ['account_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_members',
        index: 'merchant_members_merchant_account_6d8e6707',
        columns: ['merchant_id', 'account_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_members',
        index: 'merchant_members_merchant_id_idx_92be5ce7',
        columns: ['merchant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_ratings',
        index: 'merchant_ratings_customer_id_idx_e16dfa6b',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_ratings',
        index: 'merchant_ratings_merchant_created_515bf5d4',
        columns: ['merchant_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_ratings',
        index: 'merchant_ratings_merchant_id_idx_92be5ce7',
        columns: ['merchant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_ratings',
        index: 'merchant_ratings_order_customer_6c831803',
        columns: ['order_id', 'customer_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_ratings',
        index: 'merchant_ratings_order_id_idx_39ad19ad',
        columns: ['order_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_settlement_lines',
        index: 'merchant_settlement_lines_order_39ad19ad',
        columns: ['order_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_settlement_lines',
        index: 'merchant_settlement_lines_settlement_b83f36d4',
        columns: ['settlement_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_settlements',
        index: 'merchant_settlements_merchant_id_idx_92be5ce7',
        columns: ['merchant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'merchant_settlements',
        index: 'merchant_settlements_merchant_period_c87a042e',
        columns: ['merchant_id', 'period_start', 'period_end'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notification_delivery_logs',
        index: 'notification_delivery_logs_notification_0162823f',
        columns: ['notification_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notifications',
        index: 'notifications_account_created_ee599692',
        columns: ['account_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notifications',
        index: 'notifications_account_unread_a3d46cea',
        columns: ['account_id'],
        extras: { where: '(read = false)' },
      }),
      this.createIndex({
        schema: 'public',
        table: 'notifications',
        index: 'notifications_template_id_idx_dc536619',
        columns: ['template_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'order_cancellations',
        index: 'order_cancellations_cancelled_by_account_id_idx_b72b4679',
        columns: ['cancelled_by_account_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'order_financial_snapshots',
        index: 'order_financial_snapshots_commission_rule_id_idx_6a9d8a7a',
        columns: ['commission_rule_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'order_financial_snapshots',
        index: 'order_financial_snapshots_pricing_rule_id_idx_2ee6aa48',
        columns: ['pricing_rule_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'order_item_options',
        index: 'order_item_options_order_item_id_idx_92934215',
        columns: ['order_item_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'order_items',
        index: 'order_items_order_39ad19ad',
        columns: ['order_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'order_items',
        index: 'order_items_product_id_idx_22a2b7d2',
        columns: ['product_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'order_status_events',
        index: 'order_status_events_order_id_idx_39ad19ad',
        columns: ['order_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'order_status_events',
        index: 'order_status_events_order_occurred_f13a3784',
        columns: ['order_id', 'occurred_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'orders',
        index: 'orders_branch_created_323ad5ae',
        columns: ['merchant_branch_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'orders',
        index: 'orders_customer_created_cd59c338',
        columns: ['customer_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'orders',
        index: 'orders_customer_id_idx_e16dfa6b',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'orders',
        index: 'orders_delivery_zone_id_idx_13d0f83e',
        columns: ['delivery_zone_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'orders',
        index: 'orders_fulfillment_9fd7f60b',
        columns: ['fulfillment_status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'orders',
        index: 'orders_merchant_branch_id_idx_23608f05',
        columns: ['merchant_branch_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'orders',
        index: 'orders_status_created_1bbe8adf',
        columns: ['status', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payment_transactions',
        index: 'payment_transactions_payment_7931cf41',
        columns: ['payment_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payment_transactions',
        index: 'payment_transactions_provider_ref_553fa18e',
        columns: ['provider_reference'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'platform_settings',
        index: 'platform_settings_updated_by_admin_id_idx_151971d3',
        columns: ['updated_by_admin_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_option_groups',
        index: 'product_option_groups_product_id_idx_22a2b7d2',
        columns: ['product_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_options',
        index: 'product_options_option_group_id_idx_28929bf2',
        columns: ['option_group_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'products',
        index: 'products_branch_available_f365f7e8',
        columns: ['merchant_branch_id', 'available'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'products',
        index: 'products_category_da7213d4',
        columns: ['category_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'products',
        index: 'products_merchant_branch_id_idx_23608f05',
        columns: ['merchant_branch_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'promotion_redemptions',
        index: 'promotion_redemptions_customer_id_idx_e16dfa6b',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'promotion_redemptions',
        index: 'promotion_redemptions_customer_redeemed_340fbc15',
        columns: ['customer_id', 'redeemed_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'promotion_redemptions',
        index: 'promotion_redemptions_order_39ad19ad',
        columns: ['order_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'promotion_redemptions',
        index: 'promotion_redemptions_promotion_id_idx_bafc229f',
        columns: ['promotion_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refunds',
        index: 'refunds_order_39ad19ad',
        columns: ['order_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refunds',
        index: 'refunds_payment_transaction_id_idx_1ed9559f',
        columns: ['payment_transaction_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refunds',
        index: 'refunds_requested_by_admin_id_idx_c00bc1d5',
        columns: ['requested_by_admin_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refunds',
        index: 'refunds_status_requested_5b27d747',
        columns: ['status', 'requested_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'role_permissions',
        index: 'role_permissions_permission_id_idx_909cec36',
        columns: ['permission_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'role_permissions',
        index: 'role_permissions_role_id_idx_d9467c50',
        columns: ['role_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sessions',
        index: 'sessions_account_expires_0865bd89',
        columns: ['account_id', 'expires_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sessions',
        index: 'sessions_account_id_idx_3b48271c',
        columns: ['account_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sessions',
        index: 'sessions_device_id_idx_8f329912',
        columns: ['device_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_internal_notes',
        index: 'support_internal_notes_admin_id_idx_78cc3551',
        columns: ['admin_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_internal_notes',
        index: 'support_internal_notes_ticket_id_idx_837c90f6',
        columns: ['ticket_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_messages',
        index: 'support_messages_author_account_id_idx_c7cc91a9',
        columns: ['author_account_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_messages',
        index: 'support_messages_ticket_created_3e4e2619',
        columns: ['ticket_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_messages',
        index: 'support_messages_ticket_id_idx_837c90f6',
        columns: ['ticket_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_tickets',
        index: 'support_tickets_admin_status_918829da',
        columns: ['assigned_admin_id', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_tickets',
        index: 'support_tickets_assigned_admin_id_idx_0e2ac839',
        columns: ['assigned_admin_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_tickets',
        index: 'support_tickets_created_by_account_id_idx_01ca7524',
        columns: ['created_by_account_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_tickets',
        index: 'support_tickets_driver_id_idx_56c848ae',
        columns: ['driver_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_tickets',
        index: 'support_tickets_merchant_id_idx_92be5ce7',
        columns: ['merchant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_tickets',
        index: 'support_tickets_order_id_idx_39ad19ad',
        columns: ['order_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'support_tickets',
        index: 'support_tickets_status_created_1bbe8adf',
        columns: ['status', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'vehicles',
        index: 'vehicles_active_plate_uq_80939ffc',
        columns: ['plate_number'],
        extras: { where: "(status = 'ACTIVE')", unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'vehicles',
        index: 'vehicles_driver_56c848ae',
        columns: ['driver_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'addresses',
        foreignKey: {
          name: 'addresses_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'admin_profiles',
        foreignKey: {
          name: 'admin_profiles_account_id_fkey',
          columns: ['account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'admin_profiles',
        foreignKey: {
          name: 'admin_profiles_role_id_fkey',
          columns: ['role_id'],
          references: { schema: 'public', table: 'roles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'audit_logs',
        foreignKey: {
          name: 'audit_logs_admin_id_fkey',
          columns: ['admin_id'],
          references: { schema: 'public', table: 'admin_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'cart_items',
        foreignKey: {
          name: 'cart_items_cart_id_fkey',
          columns: ['cart_id'],
          references: { schema: 'public', table: 'carts', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'cart_items',
        foreignKey: {
          name: 'cart_items_product_id_fkey',
          columns: ['product_id'],
          references: { schema: 'public', table: 'products', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'carts',
        foreignKey: {
          name: 'carts_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'carts',
        foreignKey: {
          name: 'carts_merchant_branch_id_fkey',
          columns: ['merchant_branch_id'],
          references: { schema: 'public', table: 'merchant_branches', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'categories',
        foreignKey: {
          name: 'categories_merchant_branch_id_fkey',
          columns: ['merchant_branch_id'],
          references: { schema: 'public', table: 'merchant_branches', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'cod_collections',
        foreignKey: {
          name: 'cod_collections_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'cod_collections',
        foreignKey: {
          name: 'cod_collections_driver_id_fkey',
          columns: ['driver_id'],
          references: { schema: 'public', table: 'driver_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'cod_discrepancies',
        foreignKey: {
          name: 'cod_discrepancies_driver_id_fkey',
          columns: ['driver_id'],
          references: { schema: 'public', table: 'driver_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'cod_discrepancies',
        foreignKey: {
          name: 'cod_discrepancies_remittance_id_fkey',
          columns: ['remittance_id'],
          references: { schema: 'public', table: 'cod_remittances', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'cod_remittance_allocations',
        foreignKey: {
          name: 'cod_remittance_allocations_remittance_id_fkey',
          columns: ['remittance_id'],
          references: { schema: 'public', table: 'cod_remittances', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'cod_remittance_allocations',
        foreignKey: {
          name: 'cod_remittance_allocations_collection_id_fkey',
          columns: ['collection_id'],
          references: { schema: 'public', table: 'cod_collections', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'cod_remittances',
        foreignKey: {
          name: 'cod_remittances_driver_id_fkey',
          columns: ['driver_id'],
          references: { schema: 'public', table: 'driver_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_profiles',
        foreignKey: {
          name: 'customer_profiles_account_id_fkey',
          columns: ['account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'deliveries',
        foreignKey: {
          name: 'deliveries_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'delivery_events',
        foreignKey: {
          name: 'delivery_events_delivery_id_fkey',
          columns: ['delivery_id'],
          references: { schema: 'public', table: 'deliveries', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'delivery_events',
        foreignKey: {
          name: 'delivery_events_driver_id_fkey',
          columns: ['driver_id'],
          references: { schema: 'public', table: 'driver_profiles', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'delivery_pricing_rules',
        foreignKey: {
          name: 'delivery_pricing_rules_zone_id_fkey',
          columns: ['zone_id'],
          references: { schema: 'public', table: 'delivery_zones', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'delivery_proofs',
        foreignKey: {
          name: 'delivery_proofs_delivery_id_fkey',
          columns: ['delivery_id'],
          references: { schema: 'public', table: 'deliveries', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'device_tokens',
        foreignKey: {
          name: 'device_tokens_account_id_fkey',
          columns: ['account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'device_tokens',
        foreignKey: {
          name: 'device_tokens_device_id_fkey',
          columns: ['device_id'],
          references: { schema: 'public', table: 'devices', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'devices',
        foreignKey: {
          name: 'devices_account_id_fkey',
          columns: ['account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'driver_assignments',
        foreignKey: {
          name: 'driver_assignments_delivery_id_fkey',
          columns: ['delivery_id'],
          references: { schema: 'public', table: 'deliveries', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'driver_assignments',
        foreignKey: {
          name: 'driver_assignments_driver_id_fkey',
          columns: ['driver_id'],
          references: { schema: 'public', table: 'driver_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'driver_availability',
        foreignKey: {
          name: 'driver_availability_driver_id_fkey',
          columns: ['driver_id'],
          references: { schema: 'public', table: 'driver_profiles', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'driver_availability',
        foreignKey: {
          name: 'driver_availability_current_zone_id_fkey',
          columns: ['current_zone_id'],
          references: { schema: 'public', table: 'delivery_zones', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'driver_documents',
        foreignKey: {
          name: 'driver_documents_driver_id_fkey',
          columns: ['driver_id'],
          references: { schema: 'public', table: 'driver_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'driver_earnings',
        foreignKey: {
          name: 'driver_earnings_delivery_id_fkey',
          columns: ['delivery_id'],
          references: { schema: 'public', table: 'deliveries', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'driver_earnings',
        foreignKey: {
          name: 'driver_earnings_driver_id_fkey',
          columns: ['driver_id'],
          references: { schema: 'public', table: 'driver_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'driver_profiles',
        foreignKey: {
          name: 'driver_profiles_account_id_fkey',
          columns: ['account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'driver_ratings',
        foreignKey: {
          name: 'driver_ratings_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'driver_ratings',
        foreignKey: {
          name: 'driver_ratings_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'driver_ratings',
        foreignKey: {
          name: 'driver_ratings_driver_id_fkey',
          columns: ['driver_id'],
          references: { schema: 'public', table: 'driver_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'financial_ledger_entries',
        foreignKey: {
          name: 'financial_ledger_entries_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'financial_ledger_entries',
        foreignKey: {
          name: 'financial_ledger_entries_merchant_id_fkey',
          columns: ['merchant_id'],
          references: { schema: 'public', table: 'merchants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'financial_ledger_entries',
        foreignKey: {
          name: 'financial_ledger_entries_driver_id_fkey',
          columns: ['driver_id'],
          references: { schema: 'public', table: 'driver_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'financial_ledger_entries',
        foreignKey: {
          name: 'financial_ledger_entries_reversal_of_id_fkey',
          columns: ['reversal_of_id'],
          references: { schema: 'public', table: 'financial_ledger_entries', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_branches',
        foreignKey: {
          name: 'merchant_branches_merchant_id_fkey',
          columns: ['merchant_id'],
          references: { schema: 'public', table: 'merchants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_commission_rules',
        foreignKey: {
          name: 'merchant_commission_rules_merchant_id_fkey',
          columns: ['merchant_id'],
          references: { schema: 'public', table: 'merchants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_commission_rules',
        foreignKey: {
          name: 'merchant_commission_rules_changed_by_admin_id_fkey',
          columns: ['changed_by_admin_id'],
          references: { schema: 'public', table: 'admin_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_documents',
        foreignKey: {
          name: 'merchant_documents_merchant_id_fkey',
          columns: ['merchant_id'],
          references: { schema: 'public', table: 'merchants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_members',
        foreignKey: {
          name: 'merchant_members_merchant_id_fkey',
          columns: ['merchant_id'],
          references: { schema: 'public', table: 'merchants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_members',
        foreignKey: {
          name: 'merchant_members_account_id_fkey',
          columns: ['account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_ratings',
        foreignKey: {
          name: 'merchant_ratings_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_ratings',
        foreignKey: {
          name: 'merchant_ratings_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_ratings',
        foreignKey: {
          name: 'merchant_ratings_merchant_id_fkey',
          columns: ['merchant_id'],
          references: { schema: 'public', table: 'merchants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_settlement_lines',
        foreignKey: {
          name: 'merchant_settlement_lines_settlement_id_fkey',
          columns: ['settlement_id'],
          references: { schema: 'public', table: 'merchant_settlements', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_settlement_lines',
        foreignKey: {
          name: 'merchant_settlement_lines_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'merchant_settlements',
        foreignKey: {
          name: 'merchant_settlements_merchant_id_fkey',
          columns: ['merchant_id'],
          references: { schema: 'public', table: 'merchants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'notification_delivery_logs',
        foreignKey: {
          name: 'notification_delivery_logs_notification_id_fkey',
          columns: ['notification_id'],
          references: { schema: 'public', table: 'notifications', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'notifications',
        foreignKey: {
          name: 'notifications_account_id_fkey',
          columns: ['account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'notifications',
        foreignKey: {
          name: 'notifications_template_id_fkey',
          columns: ['template_id'],
          references: { schema: 'public', table: 'notification_templates', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'order_cancellations',
        foreignKey: {
          name: 'order_cancellations_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'order_cancellations',
        foreignKey: {
          name: 'order_cancellations_cancelled_by_account_id_fkey',
          columns: ['cancelled_by_account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'order_delivery_address_snapshots',
        foreignKey: {
          name: 'order_delivery_address_snapshots_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'order_financial_snapshots',
        foreignKey: {
          name: 'order_financial_snapshots_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'order_financial_snapshots',
        foreignKey: {
          name: 'order_financial_snapshots_commission_rule_id_fkey',
          columns: ['commission_rule_id'],
          references: { schema: 'public', table: 'merchant_commission_rules', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'order_financial_snapshots',
        foreignKey: {
          name: 'order_financial_snapshots_pricing_rule_id_fkey',
          columns: ['pricing_rule_id'],
          references: { schema: 'public', table: 'delivery_pricing_rules', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'order_item_options',
        foreignKey: {
          name: 'order_item_options_order_item_id_fkey',
          columns: ['order_item_id'],
          references: { schema: 'public', table: 'order_items', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'order_items',
        foreignKey: {
          name: 'order_items_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'order_items',
        foreignKey: {
          name: 'order_items_product_id_fkey',
          columns: ['product_id'],
          references: { schema: 'public', table: 'products', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'order_status_events',
        foreignKey: {
          name: 'order_status_events_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'orders',
        foreignKey: {
          name: 'orders_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'orders',
        foreignKey: {
          name: 'orders_merchant_branch_id_fkey',
          columns: ['merchant_branch_id'],
          references: { schema: 'public', table: 'merchant_branches', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'orders',
        foreignKey: {
          name: 'orders_delivery_zone_id_fkey',
          columns: ['delivery_zone_id'],
          references: { schema: 'public', table: 'delivery_zones', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'payment_transactions',
        foreignKey: {
          name: 'payment_transactions_payment_id_fkey',
          columns: ['payment_id'],
          references: { schema: 'public', table: 'payments', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'payments',
        foreignKey: {
          name: 'payments_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'platform_settings',
        foreignKey: {
          name: 'platform_settings_updated_by_admin_id_fkey',
          columns: ['updated_by_admin_id'],
          references: { schema: 'public', table: 'admin_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_option_groups',
        foreignKey: {
          name: 'product_option_groups_product_id_fkey',
          columns: ['product_id'],
          references: { schema: 'public', table: 'products', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_options',
        foreignKey: {
          name: 'product_options_option_group_id_fkey',
          columns: ['option_group_id'],
          references: { schema: 'public', table: 'product_option_groups', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'products',
        foreignKey: {
          name: 'products_merchant_branch_id_fkey',
          columns: ['merchant_branch_id'],
          references: { schema: 'public', table: 'merchant_branches', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'products',
        foreignKey: {
          name: 'products_category_id_fkey',
          columns: ['category_id'],
          references: { schema: 'public', table: 'categories', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'promotion_redemptions',
        foreignKey: {
          name: 'promotion_redemptions_promotion_id_fkey',
          columns: ['promotion_id'],
          references: { schema: 'public', table: 'promotions', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'promotion_redemptions',
        foreignKey: {
          name: 'promotion_redemptions_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'promotion_redemptions',
        foreignKey: {
          name: 'promotion_redemptions_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'refunds',
        foreignKey: {
          name: 'refunds_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'refunds',
        foreignKey: {
          name: 'refunds_payment_transaction_id_fkey',
          columns: ['payment_transaction_id'],
          references: { schema: 'public', table: 'payment_transactions', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'refunds',
        foreignKey: {
          name: 'refunds_requested_by_admin_id_fkey',
          columns: ['requested_by_admin_id'],
          references: { schema: 'public', table: 'admin_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'role_permissions',
        foreignKey: {
          name: 'role_permissions_role_id_fkey',
          columns: ['role_id'],
          references: { schema: 'public', table: 'roles', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'role_permissions',
        foreignKey: {
          name: 'role_permissions_permission_id_fkey',
          columns: ['permission_id'],
          references: { schema: 'public', table: 'permissions', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sessions',
        foreignKey: {
          name: 'sessions_account_id_fkey',
          columns: ['account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sessions',
        foreignKey: {
          name: 'sessions_device_id_fkey',
          columns: ['device_id'],
          references: { schema: 'public', table: 'devices', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'support_internal_notes',
        foreignKey: {
          name: 'support_internal_notes_ticket_id_fkey',
          columns: ['ticket_id'],
          references: { schema: 'public', table: 'support_tickets', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'support_internal_notes',
        foreignKey: {
          name: 'support_internal_notes_admin_id_fkey',
          columns: ['admin_id'],
          references: { schema: 'public', table: 'admin_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'support_messages',
        foreignKey: {
          name: 'support_messages_ticket_id_fkey',
          columns: ['ticket_id'],
          references: { schema: 'public', table: 'support_tickets', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'support_messages',
        foreignKey: {
          name: 'support_messages_author_account_id_fkey',
          columns: ['author_account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'support_tickets',
        foreignKey: {
          name: 'support_tickets_created_by_account_id_fkey',
          columns: ['created_by_account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'support_tickets',
        foreignKey: {
          name: 'support_tickets_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'orders', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'support_tickets',
        foreignKey: {
          name: 'support_tickets_merchant_id_fkey',
          columns: ['merchant_id'],
          references: { schema: 'public', table: 'merchants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'support_tickets',
        foreignKey: {
          name: 'support_tickets_driver_id_fkey',
          columns: ['driver_id'],
          references: { schema: 'public', table: 'driver_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'support_tickets',
        foreignKey: {
          name: 'support_tickets_assigned_admin_id_fkey',
          columns: ['assigned_admin_id'],
          references: { schema: 'public', table: 'admin_profiles', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'vehicles',
        foreignKey: {
          name: 'vehicles_driver_id_fkey',
          columns: ['driver_id'],
          references: { schema: 'public', table: 'driver_profiles', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
