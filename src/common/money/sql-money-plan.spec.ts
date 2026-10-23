import {
  adaptMoneyRawPlan,
  rewriteDecimalMoneySql,
  wrapDecimalMoneyClient,
} from './sql-money-plan';

describe('rewriteDecimalMoneySql', () => {
  const prev = process.env['MONEY_PRISMA_DECIMAL'];

  afterEach(() => {
    if (prev === undefined) {
      delete process.env['MONEY_PRISMA_DECIMAL'];
    } else {
      process.env['MONEY_PRISMA_DECIMAL'] = prev;
    }
  });

  it('selects NUMERIC price AS price_minor', () => {
    const sql = `
        SELECT p.id AS product_id, p.price_minor, pi.object_id::varchar AS image_object_id
        FROM products p
      `;
    const out = rewriteDecimalMoneySql(sql);
    expect(out).toContain('p.price AS price_minor');
    expect(out).not.toContain('p.price_minor');
  });

  it('rewrites SUM of BIGINT money to NUMERIC without truncating ::bigint', () => {
    const sql = `
        SELECT COALESCE(SUM(net_earning_minor), 0)::bigint AS total_earned_minor
        FROM driver_earnings
      `;
    const out = rewriteDecimalMoneySql(sql);
    expect(out).toContain('SUM(net_earning)');
    expect(out).toContain('AS total_earned_minor');
    expect(out).not.toContain('::bigint');
    expect(out).not.toContain('net_earning_minor');
  });

  it('keeps non-money bigint casts', () => {
    const sql = `SELECT SUM(i.quantity)::bigint AS quantity FROM order_items i`;
    expect(rewriteDecimalMoneySql(sql)).toContain('::bigint AS quantity');
  });

  it('strips ::bigint on refund aggregate aliases', () => {
    const out = rewriteDecimalMoneySql(
      'SELECT COALESCE(SUM(amount_minor), 0)::bigint AS reserved_refund_minor',
    );
    expect(out).toContain('SUM(amount)');
    expect(out).toContain('AS reserved_refund_minor');
    expect(out).not.toContain('::bigint');
    expect(out).not.toContain('amount_minor');
  });

  it('rewrites UNION null money columns to numeric', () => {
    const out = rewriteDecimalMoneySql('NULL::int8 AS price_minor');
    expect(out).toBe('NULL::numeric AS price_minor');
  });

  it('does not rewrite plans unless Decimal Prisma is on', () => {
    delete process.env['MONEY_PRISMA_DECIMAL'];
    const plan = {
      ast: {
        parts: ['SELECT p.price_minor FROM products p'],
        result: {
          columns: { price_minor: { codecId: 'pg/int8@1' } },
        },
      },
    };
    const out = adaptMoneyRawPlan(plan);
    expect(out).toBe(plan);
    expect(plan.ast.parts[0]).toContain('price_minor');
    expect(plan.ast.result.columns.price_minor.codecId).toBe('pg/int8@1');
  });

  it('switches money result codecs to numeric in Decimal mode', () => {
    process.env['MONEY_PRISMA_DECIMAL'] = '1';
    const plan = {
      ast: {
        parts: ['SELECT p.price_minor FROM products p'],
        result: {
          columns: {
            price_minor: { codecId: 'pg/int8@1' },
            total: { codecId: 'pg/int8@1' },
          },
        },
      },
    };
    const out = adaptMoneyRawPlan(plan);
    expect(out.ast.parts[0]).toContain('p.price AS price_minor');
    expect(out.ast.result.columns.price_minor.codecId).toBe('pg/numeric@1');
    expect(out.ast.result.columns.total.codecId).toBe('pg/int8@1');
    expect(plan.ast.parts[0]).toContain('p.price_minor');
  });

  it('rewrites plans at runtime().query without mutating raw.sql', async () => {
    process.env['MONEY_PRISMA_DECIMAL'] = '1';
    const seen: unknown[] = [];
    const frozen = Object.freeze({
      sql: Object.freeze(() => {
        throw new Error('raw.sql should not be assigned');
      }),
    });
    const client = {
      raw: frozen,
      runtime() {
        return {
          query(plan: unknown) {
            seen.push(plan);
            return (async function* () {
              yield plan;
            })();
          },
        };
      },
    };
    const wrapped = wrapDecimalMoneyClient(client);
    expect(wrapped.raw).toBe(frozen);
    const plan = {
      ast: {
        parts: ['SELECT p.price_minor FROM products p'],
        result: { columns: { price_minor: { codecId: 'pg/int8@1' } } },
      },
    };
    for await (const _row of wrapped.runtime().query(plan)) {
      void _row;
    }
    expect(seen).toHaveLength(1);
    const adapted = seen[0] as typeof plan;
    expect(adapted.ast.parts[0]).toContain('p.price AS price_minor');
    expect(adapted.ast.result.columns.price_minor.codecId).toBe('pg/numeric@1');
  });
});
