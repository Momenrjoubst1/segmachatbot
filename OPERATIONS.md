# Production Operations Runbook

Day-to-day ops for the Sigma deployment (docker-compose on a single host +
Supabase + Cloudflare R2). Development runbook lives in memory/dev docs; this
file is the production one.

## 1. Deploy

```bash
docker compose pull          # or: docker compose build
docker compose up -d --build
docker compose ps            # all services "healthy" within ~60s
curl -s http://127.0.0.1:3004/api/health | head -c 200
```

- Frontend is served on `:80`; backend is loopback-bound on `:3004`
  (reverse-proxy TLS in front of it is expected).
- After ANY deploy, watch logs for two minutes:
  `docker compose logs -f backend | head -50` — the server logs
  "Sigma AI Backend running" only after config validation passed.

## 2. Migrations — CRITICAL

The live Supabase project **predates the migration runner** (no
`schema_migrations` table — it was built from `full_schema.sql` manually).

- NEVER point `npm run db:migrate` at the live database without baselining
  first; the runner would re-apply migrations 001→032.
- Migrations 033/034/035 are idempotent drift-repair and are ALREADY applied
  to the live DB. New migrations (036+) should be applied with the runner or
  by hand, then reflected in `full_schema.sql`.

## 3. Backups & restore

Free-tier Supabase has **no automated backups** — that is why
`.github/workflows/backup.yml` exists.

1. Add the `SUPABASE_DB_URL` secret (pooler connection string) to the repo.
2. Actions → "Daily DB Backup" → run once manually → confirm the artifact.
3. Daily 03:00 UTC dumps of the `public` schema, 30-day retention.

**Restore into a fresh Supabase project:**

```bash
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "$NEW_PROJECT_DB_URL" sigma-db-<stamp>.dump
```

Notes: auth users live in Supabase's managed `auth` schema (not in this
dump) — re-invite users or export via the auth admin API separately.
Redis holds only ephemeral state (rate limits, queues) — no backup needed;
AOF persistence covers container restarts.

## 4. Health & monitoring

- `GET /api/health` → 200 with `services.redis` / `aiProviders`; the compose
  healthcheck hits it every 30s (container restarts after 3 failures).
- `GET /health` on pdf-processor (loopback :8000).
- Sentry captures backend + frontend exceptions.
- Manual smoke after any deploy: open the app in a private window, send one
  guest message, confirm the reply streams.

## 5. Known ceilings (raise before real traffic)

| Ceiling | Symptom | Fix |
|---------|---------|-----|
| Groq free tier (TPM ≈ 8k) | slow/refused guest + chat replies | paid Groq/OpenRouter key |
| OpenRouter `:free` ids flap | empty streams → model fallback churn | paid key or fewer free ids |
| Supabase free tier | no automated backups, 500 DB connections, pausing after inactivity | Pro plan + enable backups |
| Single backend replica | vertical scaling only | the locking fixes (email/memory workers) already make a 2nd replica safe for jobs; sessions/WS still pin to one host |

## 6. Incident quick actions

- Backend down: `docker compose logs --tail 100 backend`, then
  `docker compose restart backend`.
- Provider outage: the model router + fallback chains degrade gracefully;
  check `/api/health` `aiProviders` to see which keys are configured.
- DB restore needed: see §3 — restore into a NEW project, then flip
  `SUPABASE_URL`/service key in `.env` and `docker compose up -d backend`.

## 7. What NOT to touch

- `full_schema.sql` is a reference, never applied by the runner (see §2).
- `banned_users`, `agent_conversation_events`, `analytics_daily_metrics`
  policies are service_role-scoped — do not loosen them (they once were
  `TO public` and that was a live vulnerability).
- The ElevenLabs `xi-api-key` must never reach the browser; `/api/voice/*`
  mints short-lived signed URLs instead.
