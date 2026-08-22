# R2 Lifecycle — chat attachments auto-expiry

Chat attachments live in R2 under `chat-attachments/{userId}/…`. Deletion
happens explicitly when a user removes a composer attachment, but objects
from abandoned sessions (tab closed mid-upload, never sent) need a safety
net. The lifecycle rule below deletes anything under the prefix
automatically.

## Recommended rule

| Field  | Value                 |
|--------|-----------------------|
| Prefix | `chat-attachments/`   |
| Action | Delete objects        |
| Age    | **7 days** after upload |

7 days comfortably covers any realistic conversation window (attachments
are referenced by later turns only while the thread stays active) while
keeping storage bounded. Gemini-staged copies are separate and expire on
their own after 48h.

## Apply it

**Automatic** (needs an API token with R2 Storage:Edit — set
`CLOUDFLARE_API_TOKEN` in backend/.env):

```bash
cd backend && npx tsx scripts/r2-lifecycle.mts --days 7 --prefix chat-attachments/
```

The script merges with existing rules (matched by id
`chat-attachments-expiry`), so it is safe to re-run with different values.

**Manual** — Dashboard → R2 → bucket → Settings → Object lifecycle rules:

1. Add rule → name `chat-attachments-expiry`
2. Scope: apply to objects with prefix `chat-attachments/`
3. Action: Delete objects, `${days}` days after upload

Or wrangler ≥3.x:

```bash
npx wrangler r2 bucket lifecycle add <bucket> \
  --id chat-attachments-expiry --prefix "chat-attachments/" --expire-days 7
```

## Note on pending/ legacy prefix

The old inline-base64 flow staged files under `pending/{userId}/`; those are
superseded/deleted by the chat file router itself. If you want belt-and-
suspenders coverage, add a second rule for the `pending/` prefix.
