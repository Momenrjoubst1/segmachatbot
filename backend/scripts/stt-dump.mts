/** Dump STT metering keys from Redis. Run from backend/: npx tsx scripts/stt-dump.mts */
import "dotenv/config";
import redis from "../src/config/redis/client.js";

async function main() {
  const keys = await redis.keys("stt:*");
  console.log(`stt keys: ${keys.length}`);
  for (const k of keys.slice(0, 30)) {
    const v = await redis.get(k);
    const type = k.startsWith("stt:active") ? "ACTIVE" : "minutes";
    console.log(`${type}  ${k} = ${v}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });