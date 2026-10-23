/**
 * Isolated Decimal Prisma runtime still uses domain *Minor names in raw SQL
 * (historical BIGINT columns). Those names are compatibility aliases, not DZD.
 *
 * When MONEY_PRISMA_DECIMAL=1, rewrite built raw plans to read NUMERIC DZD
 * columns and decode them with pg/numeric. Shared BigInt SQL is unchanged.
 */
import { isDecimalPrismaStorage } from './prisma-money-decimal';

/** Longest-first BIGINT column → NUMERIC DZD column. */
export const SQL_MONEY_MINOR_TO_DZD: ReadonlyArray<readonly [string, string]> = [
  ['gross_merchandise_subtotal_minor', 'gross_merchandise_subtotal'],
  ['merchant_commission_amount_minor', 'merchant_commission_amount'],
  ['customer_delivery_fee_minor', 'customer_delivery_fee'],
  ['speedygo_delivery_share_minor', 'speedygo_delivery_share'],
  ['driver_remuneration_minor', 'driver_remuneration'],
  ['merchant_net_amount_minor', 'merchant_net_amount'],
  ['refund_adjustments_minor', 'refund_adjustments'],
  ['manual_adjustments_minor', 'manual_adjustments'],
  ['collected_amount_minor', 'collected_amount'],
  ['submitted_amount_minor', 'submitted_amount'],
  ['confirmed_amount_minor', 'confirmed_amount'],
  ['allocated_amount_minor', 'allocated_amount'],
  ['expected_amount_minor', 'expected_amount'],
  ['discount_amount_minor', 'discount_amount'],
  ['platform_discount_minor', 'platform_discount'],
  ['merchant_discount_minor', 'merchant_discount'],
  ['commission_base_minor', 'commission_base'],
  ['customer_payable_minor', 'customer_payable'],
  ['base_remuneration_minor', 'base_remuneration'],
  ['additional_price_minor', 'additional_price'],
  ['gross_merchandise_minor', 'gross_merchandise'],
  ['total_discount_minor', 'total_discount'],
  ['net_payable_minor', 'net_payable'],
  ['merchant_net_minor', 'merchant_net'],
  ['service_fee_minor', 'service_fee'],
  ['commission_minor', 'commission'],
  ['gross_sales_minor', 'gross_sales'],
  ['line_total_minor', 'line_total'],
  ['unit_price_minor', 'unit_price'],
  ['net_earning_minor', 'net_earning'],
  ['difference_minor', 'difference_amount'],
  ['confirmed_minor', 'confirmed_amount'],
  ['expected_minor', 'expected_amount'],
  ['adjustment_minor', 'adjustment'],
  ['amount_minor', 'amount'],
  ['price_minor', 'price'],
  ['bonus_minor', 'bonus'],
];

const MONEY_RESULT_ALIASES = new Set<string>([
  ...SQL_MONEY_MINOR_TO_DZD.map(([minor]) => minor),
  'gms',
  'revenue',
  'amount_sum',
  'outstanding_minor',
  'total_earned_minor',
  'unpaid_earned_minor',
  'reserved_refund_minor',
  'successful_refund_minor',
  'difference_sum',
  'finalized_net',
  'adjustments',
  'commission',
  'merchant_net',
  'merchant_discount',
  'platform_discount',
  'delivery_fee',
  'driver_remuneration',
  'delivery_share',
  'customer_payable',
]);

function isMoneyResultAlias(name: string): boolean {
  return MONEY_RESULT_ALIASES.has(name) || /_minor$/.test(name);
}

export function rewriteDecimalMoneySql(sql: string): string {
  let s = sql;
  s = s.replace(/NULL::int8 AS ([a-z_]+)/g, (full, alias: string) =>
    isMoneyResultAlias(alias) ? `NULL::numeric AS ${alias}` : full,
  );
  for (const [minor, dzd] of SQL_MONEY_MINOR_TO_DZD) {
    s = s.replace(
      new RegExp(`\\bSUM\\((?:([A-Za-z_][A-Za-z0-9_]*)\\.)?${minor}\\)`, 'g'),
      (_full, qual: string | undefined) =>
        `SUM(${qual ? `${qual}.${dzd}` : dzd})`,
    );
  }
  s = s.replace(/::bigint AS ([a-z_]+)/g, (full, alias: string) =>
    isMoneyResultAlias(alias) ? ` AS ${alias}` : full,
  );
  for (const [minor, dzd] of SQL_MONEY_MINOR_TO_DZD) {
    s = s.replace(
      new RegExp(`\\b([A-Za-z_][A-Za-z0-9_]*)\\.${minor}\\b`, 'g'),
      (_full, qual: string) => `${qual}.${dzd} AS ${minor}`,
    );
    s = s.replace(
      new RegExp(`(?<!AS )\\b${minor}\\b`, 'g'),
      dzd,
    );
  }
  return s;
}

type RawPlan = {
  ast?: {
    parts?: unknown[];
    result?: { columns?: Record<string, { codecId?: string }> };
  };
};

function cloneWithPrototype<T extends object>(value: T): T {
  const next = Object.create(Object.getPrototypeOf(value)) as T;
  Object.assign(next, value);
  return next;
}

export function adaptMoneyRawPlan<T>(plan: T): T {
  if (!isDecimalPrismaStorage() || !plan || typeof plan !== 'object') {
    return plan;
  }
  const ast = (plan as RawPlan).ast;
  if (!ast) {
    return plan;
  }
  const nextAst = cloneWithPrototype(ast);
  if (Array.isArray(ast.parts)) {
    nextAst.parts = ast.parts.map((part) =>
      typeof part === 'string' ? rewriteDecimalMoneySql(part) : part,
    );
  }
  if (ast.result) {
    const nextResult = cloneWithPrototype(ast.result);
    if (ast.result.columns) {
      const nextColumns = { ...ast.result.columns };
      for (const [name, col] of Object.entries(ast.result.columns)) {
        if (col && col.codecId === 'pg/int8@1' && isMoneyResultAlias(name)) {
          nextColumns[name] = { ...col, codecId: 'pg/numeric@1' };
        }
      }
      nextResult.columns = nextColumns;
    }
    nextAst.result = nextResult;
  }
  const nextPlan = cloneWithPrototype(plan as object);
  (nextPlan as RawPlan).ast = nextAst;
  return nextPlan as T;
}

/**
 * Prisma `raw.sql` is a non-configurable data property, so it cannot be
 * assigned or proxied on the original object. Intercept `runtime().query`
 * instead — that is where built plans are executed.
 */
export function wrapDecimalMoneyClient<T extends object>(client: T): T {
  const original = client as {
    runtime?: () => { query: (plan: unknown) => AsyncIterable<unknown> };
  };
  const originalRuntime = original.runtime?.bind(original);
  if (typeof originalRuntime !== 'function') {
    return client;
  }
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'runtime') {
          return () => {
            const rt = originalRuntime();
            const originalQuery = rt.query.bind(rt);
            return new Proxy(
              {},
              {
                get(_t2, p2) {
                  if (p2 === 'query') {
                    return (plan: unknown) =>
                      originalQuery(adaptMoneyRawPlan(plan));
                  }
                  const value = Reflect.get(rt, p2, rt);
                  return typeof value === 'function' ? value.bind(rt) : value;
                },
              },
            );
          };
        }
        const value = Reflect.get(client, prop, client);
        return typeof value === 'function' ? value.bind(client) : value;
      },
      has(_target, prop) {
        return prop in client;
      },
    },
  ) as T;
}

/** @deprecated use wrapDecimalMoneyClient */
export function wrapRawSqlBuilder<T extends object>(rawOrClient: T): T {
  return wrapDecimalMoneyClient(rawOrClient);
}
