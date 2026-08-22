#!/usr/bin/env node
// ==========================================
// Database Migration Runner
// ==========================================
// Applies pending SQL migrations from the migrations/ folder.
// Tracks applied migrations in a schema_migrations table.
//
// Usage:
//   cd backend && npm run db:migrate
//   node ../scripts/db/apply-migrations.js
//
// Environment:
//   DATABASE_URL — PostgreSQL connection string
//   Defaults to postgresql://postgres:postgres@localhost:54321/postgres (Supabase local)
// ==========================================

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:54321/postgres";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");
const SETUP_SQL_PATH = path.resolve(__dirname, "./setup-tracking.sql");

// Files to skip (not actual migrations)
const SKIP_FILES = new Set(["full_schema.sql", "README.md", "setup-tracking.sql"]);

async function main() {
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const usingDefault = !process.env.DATABASE_URL;

  if (usingDefault) {
    console.warn(
      "⚠️  DATABASE_URL not set. Using default: " + DEFAULT_DATABASE_URL
    );
    console.warn("   Set DATABASE_URL to connect to a different database.\n");
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log(`✅ Connected to database\n`);

    // 1. Ensure schema_migrations table exists
    const setupSql = fs.readFileSync(SETUP_SQL_PATH, "utf-8");
    await client.query(setupSql);
    console.log("✅ schema_migrations table ready\n");

    // 2. Get already-applied migrations
    const { rows: applied } = await client.query(
      "SELECT version, filename FROM schema_migrations ORDER BY version"
    );
    const appliedSet = new Set(applied.map((r) => r.version));
    if (applied.length > 0) {
      console.log(
        `📋 Already applied: ${applied.map((r) => r.version).join(", ")}\n`
      );
    }

    // 3. Find migration files
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") && !SKIP_FILES.has(f))
      .sort();

    if (files.length === 0) {
      console.log("No migration files found in migrations/");
      return;
    }

    // 4. Filter to pending migrations
    const pending = files.filter((f) => {
      const version = f.replace(".sql", "");
      return !appliedSet.has(version);
    });

    if (pending.length === 0) {
      console.log("✅ All migrations already applied. Nothing to do.\n");
      return;
    }

    console.log(`🔄 ${pending.length} pending migration(s):\n`);
    for (const f of pending) {
      console.log(`   - ${f}`);
    }
    console.log("");

    // 5. Apply each pending migration
    let appliedCount = 0;
    for (const filename of pending) {
      const version = filename.replace(".sql", "");
      const filePath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(filePath, "utf-8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");

      const hasConcurrently = /\bCONCURRENTLY\b/i.test(sql);
      const wrapInTransaction = !hasConcurrently;

      process.stdout.write(`⏳ Applying ${filename}...`);

      const startTime = Date.now();

      try {
        if (wrapInTransaction) {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("COMMIT");
        } else {
          // CREATE INDEX CONCURRENTLY cannot run inside a transaction
          await client.query(sql);
        }

        // Record the migration
        await client.query(
          "INSERT INTO schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)",
          [version, filename, checksum]
        );

        const elapsed = Date.now() - startTime;
        console.log(` ✅ (${elapsed}ms)`);
        appliedCount++;
      } catch (err) {
        // Rollback on failure
        if (wrapInTransaction) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // Ignore rollback errors
          }
        }
        console.log(` ❌ FAILED`);
        console.error(`\nError in ${filename}:`);
        console.error(err.message);
        console.error(
          "\nFix the migration SQL and re-run. Already-applied migrations will be skipped.\n"
        );
        process.exit(1);
      }
    }

    console.log(
      `\n✅ Done. ${appliedCount} migration(s) applied successfully.\n`
    );

    // 6. Show final state
    const { rows: final } = await client.query(
      "SELECT version, filename, applied_at FROM schema_migrations ORDER BY version"
    );
    console.log("📋 All applied migrations:");
    for (const row of final) {
      console.log(
        `   ${row.version} — ${row.filename} (applied: ${row.applied_at.toISOString()})`
      );
    }
    console.log("");
  } catch (err) {
    console.error("\n❌ Migration runner failed:");
    console.error(err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
