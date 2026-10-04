import {
  OWNER_ACCOUNT_ID,
  OWNER_PHONE,
  REVIEWER_ACCOUNT_ID,
  REVIEWER_PHONE,
  REVIEWER_PROFILE_ID,
  branchId,
  categoryId,
  classificationId,
  intervalId,
  memberId,
  merchantId,
  optionGroupId,
  optionId,
  productId,
  scheduleId,
} from './ids.mjs';
import { NEW_VERTICALS, STOREFRONTS } from './catalog.mjs';

function sqlStr(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNum(value) {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return String(value);
}

export function generateReviewCatalogSql() {
  const lines = [];
  lines.push(`-- SpeedyGo development REVIEW catalog fixture`);
  lines.push(`-- SYNTHETIC ONLY. Namespace 0d00c071-d000-7000-8000-*.`);
  lines.push(`-- Target: 127.0.0.1:5433 / speedygo_dev`);
  lines.push(`-- Idempotent ON CONFLICT (id) DO NOTHING. No UPDATE/DELETE.`);
  lines.push(`-- Does not touch 0d00c070-*, live accounts, orders, payments, promotions.`);
  lines.push('');
  lines.push(`DO $$`);
  lines.push(`BEGIN`);
  lines.push(`  IF current_database() <> 'speedygo_dev' THEN`);
  lines.push(`    RAISE EXCEPTION`);
  lines.push(
    `      'Refused review catalog fixture: expected database speedygo_dev, got %',`,
  );
  lines.push(`      current_database();`);
  lines.push(`  END IF;`);
  lines.push(`END`);
  lines.push(`$$;`);
  lines.push('');

  lines.push(`INSERT INTO accounts (id, phone, email, status) VALUES`);
  lines.push(
    `  (${sqlStr(OWNER_ACCOUNT_ID)}, ${sqlStr(OWNER_PHONE)}, NULL, 'ACTIVE'),`,
  );
  lines.push(
    `  (${sqlStr(REVIEWER_ACCOUNT_ID)}, ${sqlStr(REVIEWER_PHONE)}, NULL, 'ACTIVE')`,
  );
  lines.push(`ON CONFLICT (id) DO NOTHING;`);
  lines.push('');
  lines.push(`INSERT INTO customer_profiles (id, account_id, full_name, avatar_url)`);
  lines.push(`VALUES (`);
  lines.push(`  ${sqlStr(REVIEWER_PROFILE_ID)},`);
  lines.push(`  ${sqlStr(REVIEWER_ACCOUNT_ID)},`);
  lines.push(`  ${sqlStr('Revue Catalogue SpeedyGo')},`);
  lines.push(`  NULL`);
  lines.push(`)`);
  lines.push(`ON CONFLICT (id) DO NOTHING;`);
  lines.push('');

  lines.push(`INSERT INTO commerce_verticals (id, slug, name, icon_key, sort_order, active)`);
  lines.push(`VALUES`);
  lines.push(
    NEW_VERTICALS.map(
      (v) =>
        `  (${sqlStr(v.id)}, ${sqlStr(v.slug)}, ${sqlStr(v.name)}, ${sqlStr(v.iconKey)}, ${v.sortOrder}, TRUE)`,
    ).join(',\n'),
  );
  lines.push(`ON CONFLICT (id) DO NOTHING;`);
  lines.push('');

  const merchants = [];
  const branches = [];
  const classifications = [];
  const members = [];
  const schedules = [];
  const intervals = [];
  const categories = [];
  const products = [];
  const groups = [];
  const options = [];

  for (const store of STOREFRONTS) {
    const mid = merchantId(store.n);
    const bid = branchId(store.n);
    merchants.push(
      `  (${sqlStr(mid)}, ${sqlStr(store.publicReference)}, ${sqlStr(store.merchantName)}, 'ACTIVE', NOW())`,
    );
    branches.push(
      `  (${sqlStr(bid)}, ${sqlStr(mid)}, ${sqlStr(store.branchName)}, ${sqlStr(store.phone)}, ${sqlStr(store.addressText)}, ${sqlNum(store.latitude)}, ${sqlNum(store.longitude)}, 'ACTIVE')`,
    );
    classifications.push(
      `  (${sqlStr(classificationId(store.n))}, ${sqlStr(bid)}, ${sqlStr(store.verticalId)})`,
    );
    members.push(
      `  (${sqlStr(memberId(store.n))}, ${sqlStr(mid)}, ${sqlStr(OWNER_ACCOUNT_ID)}, 'OWNER')`,
    );

    if (store.hours.kind !== 'none') {
      const sid = scheduleId(store.n);
      schedules.push(
        `  (${sqlStr(sid)}, ${sqlStr(bid)}, 1, ${sqlStr(OWNER_ACCOUNT_ID)})`,
      );
      if (store.hours.kind === 'weekly') {
        for (const block of store.hours.intervals) {
          for (const day of block.days) {
            const closesNextDay = block.closesNextDay === true;
            intervals.push(
              `  (${sqlStr(intervalId(store.n, day, 0))}, ${sqlStr(sid)}, ${day}, ${block.opens}, ${block.closes}, ${closesNextDay ? 'TRUE' : 'FALSE'}, 0)`,
            );
          }
        }
      }
    }

    store.menu.forEach((cat, catIndex) => {
      const cid = categoryId(store.n, catIndex + 1);
      categories.push(
        `  (${sqlStr(cid)}, ${sqlStr(bid)}, ${sqlStr(cat.name)}, ${catIndex + 1}, TRUE)`,
      );
      cat.products.forEach((prod, prodIndex) => {
        const pid = productId(store.n, catIndex * 20 + prodIndex + 1);
        products.push(
          `  (${sqlStr(pid)}, ${sqlStr(bid)}, ${sqlStr(cid)}, ${sqlStr(prod.name)}, ${sqlStr(prod.description)}, ${prod.priceMinor}, TRUE)`,
        );
        (prod.options || []).forEach((group, gIndex) => {
          const gid = optionGroupId(store.n, catIndex * 20 + prodIndex + 1, gIndex + 1);
          groups.push(
            `  (${sqlStr(gid)}, ${sqlStr(pid)}, ${sqlStr(group.name)}, ${group.required ? 'TRUE' : 'FALSE'}, ${group.minSelections}, ${group.maxSelections})`,
          );
          group.options.forEach((opt, oIndex) => {
            options.push(
              `  (${sqlStr(optionId(store.n, catIndex * 20 + prodIndex + 1, gIndex + 1, oIndex + 1))}, ${sqlStr(gid)}, ${sqlStr(opt.name)}, ${opt.additionalPriceMinor}, TRUE)`,
            );
          });
        });
      });
    });
  }

  lines.push(`INSERT INTO merchants (id, public_reference, name, status, verified_at)`);
  lines.push(`VALUES`);
  lines.push(merchants.join(',\n'));
  lines.push(`ON CONFLICT (id) DO NOTHING;`);
  lines.push('');

  lines.push(`INSERT INTO merchant_branches (id, merchant_id, name, phone, address_text, latitude, longitude, operational_status)`);
  lines.push(`VALUES`);
  lines.push(branches.join(',\n'));
  lines.push(`ON CONFLICT (id) DO NOTHING;`);
  lines.push('');

  lines.push(`INSERT INTO merchant_branch_classifications (id, branch_id, vertical_id)`);
  lines.push(`VALUES`);
  lines.push(classifications.join(',\n'));
  lines.push(`ON CONFLICT (id) DO NOTHING;`);
  lines.push('');

  lines.push(`INSERT INTO merchant_members (id, merchant_id, account_id, role)`);
  lines.push(`VALUES`);
  lines.push(members.join(',\n'));
  lines.push(`ON CONFLICT (id) DO NOTHING;`);
  lines.push('');

  lines.push(`INSERT INTO merchant_branch_opening_schedules (id, branch_id, version, updated_by_account_id)`);
  lines.push(`VALUES`);
  lines.push(schedules.join(',\n'));
  lines.push(`ON CONFLICT (id) DO NOTHING;`);
  lines.push('');

  if (intervals.length > 0) {
    lines.push(`INSERT INTO merchant_branch_opening_intervals (id, schedule_id, day_of_week, opens_minute, closes_minute, closes_next_day, sort_order)`);
    lines.push(`VALUES`);
    lines.push(intervals.join(',\n'));
    lines.push(`ON CONFLICT (id) DO NOTHING;`);
    lines.push('');
  }

  lines.push(`INSERT INTO categories (id, merchant_branch_id, name, sort_order, active)`);
  lines.push(`VALUES`);
  lines.push(categories.join(',\n'));
  lines.push(`ON CONFLICT (id) DO NOTHING;`);
  lines.push('');

  lines.push(`INSERT INTO products (id, merchant_branch_id, category_id, name, description, price_minor, available)`);
  lines.push(`VALUES`);
  lines.push(products.join(',\n'));
  lines.push(`ON CONFLICT (id) DO NOTHING;`);
  lines.push('');

  if (groups.length > 0) {
    lines.push(`INSERT INTO product_option_groups (id, product_id, name, required, min_selections, max_selections)`);
    lines.push(`VALUES`);
    lines.push(groups.join(',\n'));
    lines.push(`ON CONFLICT (id) DO NOTHING;`);
    lines.push('');
  }

  if (options.length > 0) {
    lines.push(`INSERT INTO product_options (id, option_group_id, name, additional_price_minor, available)`);
    lines.push(`VALUES`);
    lines.push(options.join(',\n'));
    lines.push(`ON CONFLICT (id) DO NOTHING;`);
    lines.push('');
  }

  return lines.join('\n');
}
