/**
 * Applies the schema. Idempotent, so running it twice is a no-op.
 *
 * A deploy step rather than something that happens on a cold start: DDL racing
 * across serverless instances is a bad way to find out about lock contention.
 */
import "./env";

import { connectionString } from "../lib/db/client";
import { migrate } from "../lib/db/schema";

async function main() {
  const host = new URL(connectionString().replace(/^postgres/, "http")).host;
  console.log(`applying schema to ${host}`);
  await migrate();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
