# Algeria administrative reference (Wilaya / Commune)

## Provenance

| Field | Value |
| --- | --- |
| File | `algeria_69_wilayas_1541_communes.json` |
| SHA-256 | `92fa211dcb606e7e9d83f3c426bd3a80930cacef74ecb9fded00b6de2a3e5f55` |
| Schema version | `1.0.0` |
| Compiled on | `2026-09-20` |
| Wilaya count | 69 |
| Commune count | 1541 |
| Administrative basis | Loi 26-06 du 4 avril 2026, Journal officiel no 25 du 5 avril 2026 |
| Status | Compiled reference dataset — **not** an official government publication |

### Sources (from dataset metadata)

1. 58-wilaya bilingual baseline — GitHub `wadiemendja/algeria-communes-wilayas` (MIT); internal commune identifiers.
2. Authoritative 2026 membership changes — JORADP F2026025.pdf / A2026025.pdf.
3. 2019 reform (Tabelbala assignment).

### Identifier rules

- `wilaya.code`: two-digit string with leading zeros (`01`…`69`).
- `commune.id`: SpeedyGo catalogue integer from the dataset. **Not** an official ONS code or postal code.

### Effective vs announced

The 2026 law provides for progressive transfer of administrative responsibilities until 31 December 2026. This catalogue stores the **69-wilaya territorial membership** as compiled in the dataset validation block (21 affected wilayas checked against the French official text).

## Import

```bash
cd apps/backend
pnpm geo:import-algeria
# optional: GEO_ALGERIA_JSON=/absolute/path/to/file.json pnpm geo:import-algeria
```

Idempotent upsert by primary key. Does **not** truncate. Does **not** run on API startup. Refuses import if checksum/metadata totals do not match expected provenance unless `--force-unverified` is passed after documenting blockers.
