import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

try {
  process.loadEnvFile?.(".env");
} catch {
  // no .env file: fall back to DATABASE_URL from the environment or the local default
}

const url = process.env.DATABASE_URL ?? "postgres://quoteflow:quoteflow@localhost:54329/quoteflow";

async function main() {
  const client = new Client({ connectionString: url });
  await client.connect();
  if (process.argv.includes("--reset")) {
    await client.query("drop schema public cascade; create schema public;");
    console.log("schema reset");
  }
  await client.query(readFileSync(join(__dirname, "schema.sql"), "utf8"));
  console.log("schema applied");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
