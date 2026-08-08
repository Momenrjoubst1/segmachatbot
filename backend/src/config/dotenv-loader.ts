import fs from "fs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = [
  path.resolve(__dirname, "../../.env.local"),
  path.resolve(__dirname, "../../../.env.local"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../../../.env"),
];

for (const file of envCandidates) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file, override: false });
  }
}
