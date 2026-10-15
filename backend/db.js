const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Configure it as an environment variable.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});

async function initDb() {
  // R1 schema first, then the additive R2 migration. Both are idempotent, so a
  // restart or redeploy re-runs them harmlessly.
  for (const file of ["schema.sql", "schema_r2.sql"]) {
    await pool.query(fs.readFileSync(path.join(__dirname, file), "utf8"));
  }
}

module.exports = { pool, initDb };
