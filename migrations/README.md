# Database Migrations

This folder contains SQL migration files that track the database schema evolution. Each file is a numbered SQL script that modifies the schema.

## How It Works

- Migrations are applied in filename order (001 → 002 → 004 → ... → 019)
- A `schema_migrations` table in the database tracks which files have been applied
- The apply script skips already-applied migrations
- `full_schema.sql` is a reference document (not applied by the script)

## Quick Start

```bash
cd backend
npm run db:migrate
```

Requires `DATABASE_URL` env var. Defaults to `postgresql://postgres:postgres@localhost:54321/postgres` (Supabase local).

## Creating a New Migration

1. Create a new file with the next number:
   ```
   migrations/020_your_feature_name.sql
   ```

2. Write your SQL in the file (use `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, etc. for idempotency)

3. Run the migration:
   ```bash
   cd backend && npm run db:migrate
   ```

4. The script will detect the new file, execute it, and record it in `schema_migrations`

## Naming Convention

```
NNN_descriptive_name.sql
```

- `NNN` — three-digit zero-padded number (020, 021, ...)
- Use underscores, not hyphens
- Be descriptive: `020_add_user_preferences_table.sql`

## Checking Applied Migrations

```sql
SELECT version, filename, applied_at
FROM schema_migrations
ORDER BY version;
```

## Files

| File | Purpose |
|---|---|
| `001_initial_schema.sql` through `019_*.sql` | Historical migrations (already applied to production) |
| `full_schema.sql` | **Reference only** — canonical schema as of migration 019. Do NOT apply this file. |

## Important Notes

- **CONCURRENTLY**: If your migration uses `CREATE INDEX CONCURRENTLY`, the script will run it outside a transaction automatically (detected by keyword).
- **Idempotency**: Use `IF NOT EXISTS` / `IF EXISTS` in your migrations so they can be safely re-run.
- **full_schema.sql**: This is updated manually to reflect the current state after all migrations. It's a reference, not a migration.

## Known Gaps & Drift (documented 2026-08-28)

- **003 and 026 do not exist.** The numbers were skipped historically; do not
  reuse them. Next free number is listed by `ls migrations/ | tail -1`.
- **The live database predates this runner.** There is no `schema_migrations`
  table in the live project — it was built by applying `full_schema.sql`
  (and later changes) manually. Consequences:
  - Do NOT point `npm run db:migrate` at the live DB without baselining
    first: the runner would try to apply every numbered migration from 001.
  - Migrations 033/034/035 are **drift-repair** migrations: they reproduce the
    live security posture (RLS on chat/memory/ban/orphan tables, re-scoped
    service-role policies, user-scoped `match_documents`) in the numbered
    chain. They are idempotent and have been applied to the live DB.
- **`full_schema.sql` is a reference, not applied** (see above). Migrations
  033+ are now the canonical source for the policies it describes.
