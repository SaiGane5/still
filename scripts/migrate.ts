import { migrate } from "../src/server/migrate";
import { closePool } from "../src/server/db";

process.loadEnvFile?.(".env.local");
migrate()
  .then((a) => console.log(a.length ? `applied: ${a.join(", ")}` : "up to date"))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(closePool);
