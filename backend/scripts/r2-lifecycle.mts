// Apply an auto-expiry lifecycle rule to the R2 bucket for chat attachments; needs CLOUDFLARE_API_TOKEN.
import "dotenv/config";

interface LifecycleRule {
  id: string;
  enabled: boolean;
  conditions: { prefix?: string };
  actions: Array<Record<string, unknown>>;
}

function parseArgs(): { days: number; prefix: string } {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    days: Math.max(1, parseInt(get("--days", "7"), 10) || 7),
    prefix: get("--prefix", "chat-attachments/"),
  };
}

function printManualSteps(days: number, prefix: string): void {
  console.log(`
No CLOUDFLARE_API_TOKEN found — apply the rule manually (one minute):

Dashboard → R2 → bucket "${process.env.R2_BUCKET_NAME || "<bucket>"}" → Settings → Object lifecycle rules → Add rule
  • Rule name:      chat-attachments-expiry
  • Scope:          Apply to objects with prefix "${prefix}"
  • Action:         Delete objects
  • Delete objects: ${days} days after upload

Or with wrangler ≥3.x:
  npx wrangler r2 bucket lifecycle add ${process.env.R2_BUCKET_NAME || "<bucket>"} \\
    --id chat-attachments-expiry --prefix "${prefix}" --expire-days ${days}
`);
}

async function main() {
  const { days, prefix } = parseArgs();
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME;
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !bucket) {
    console.error("R2_ACCOUNT_ID / R2_BUCKET_NAME must be set");
    process.exit(1);
  }
  if (!token) {
    printManualSteps(days, prefix);
    return;
  }

  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/lifecycle`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const RULE_ID = "chat-attachments-expiry";

  // Read existing rules so we merge instead of clobbering.
  let existing: LifecycleRule[] = [];
  const getRes = await fetch(base, { headers, signal: AbortSignal.timeout(30_000) });
  if (getRes.ok) {
    const json = (await getRes.json()) as { result?: { rules?: LifecycleRule[] } };
    existing = (json.result?.rules ?? []).filter((r) => r.id !== RULE_ID);
  } else if (getRes.status !== 404) {
    console.error(`Could not read current rules (${getRes.status}): ${await getRes.text()}`);
    process.exit(1);
  }

  const merged: LifecycleRule = {
    id: RULE_ID,
    enabled: true,
    conditions: { prefix },
    actions: [{ type: "DeleteObjects", daysAfterUpload: days }],
  };

  const putRes = await fetch(base, {
    method: "PUT",
    headers,
    body: JSON.stringify({ rules: [...existing, merged] }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!putRes.ok) {
    console.error(`Failed to apply rule (${putRes.status}): ${await putRes.text()}`);
    console.log("\nIf this is a schema mismatch, apply via the dashboard:");
    printManualSteps(days, prefix);
    process.exit(1);
  }

  console.log(`Lifecycle rule applied: delete "${prefix}*" ${days} day(s) after upload`);
}

main().catch((e) => {
  console.error("r2-lifecycle failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
