// One-command database setup:  npm run setup-db
//
//   1. 01_schema_and_seed.sql      tables + synthetic hospitals/patients/cases (DROPS and recreates tables)
//   2. 02_ml_training_patch.sql    ~437,000 synthetic historical cases for forecasting (takes 1-3 minutes)
//   3. 03_appointments.sql         appointments table
//   4. 04_app_tables.sql           users / profiles / prescriptions
//   5. 05_complete_demo_data.sql   missing resources + doctors for every hospital
//   6. demo accounts + fresh demo queue
//
// Safe by default: if the database already holds hospitals, steps 1-2 are skipped unless you pass --reset.
// Flags:  --reset  rebuild everything from scratch      --skip-ml  skip the large ML history patch
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DB_DIR = path.join(__dirname, "..", "..", "database");
const DB_NAME = process.env.DB_NAME || "hospital_surge_db";
const args = new Set(process.argv.slice(2));

// Splits a .sql file into statements. Understands the mysql client's DELIMITER command,
// which is needed for CREATE PROCEDURE blocks, and ignores comment-only lines.
function splitSql(text) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  for (const rawLine of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const delimiterCmd = /^DELIMITER\s+(\S+)\s*$/i.exec(line);
    if (delimiterCmd) {
      delimiter = delimiterCmd[1];
      continue;
    }
    if (!buffer && (line === "" || line.startsWith("--"))) continue;
    buffer += rawLine + "\n";
    if (line.endsWith(delimiter)) {
      const stmt = buffer.trim().slice(0, -delimiter.length).trim();
      if (stmt) statements.push(stmt);
      buffer = "";
    }
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

async function runFile(conn, file) {
  const statements = splitSql(fs.readFileSync(path.join(DB_DIR, file), "utf8"));
  const started = Date.now();
  process.stdout.write(`-> ${file} (${statements.length} statements) ... `);
  for (const stmt of statements) {
    try {
      await conn.query(stmt);
    } catch (error) {
      console.error(`\nFAILED in ${file}: ${error.message}\n--- statement began with ---\n${stmt.slice(0, 300)}`);
      throw error;
    }
  }
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD,
    charset: "utf8mb4"
  });
  console.log(`Connected to MySQL as ${process.env.DB_USER || "root"}. Target database: ${DB_NAME}`);

  let loaded = false;
  try {
    const [rows] = await conn.query(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = 'hospitals'",
      [DB_NAME]
    );
    if (Number(rows[0].n) > 0) {
      const [[count]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${DB_NAME}\`.hospitals`);
      loaded = Number(count.n) > 0;
    }
  } catch {
    loaded = false;
  }

  if (loaded && !args.has("--reset")) {
    console.log("Database already contains hospitals - keeping existing data (use --reset to rebuild).");
  } else {
    await runFile(conn, "01_schema_and_seed.sql");
    if (args.has("--skip-ml")) {
      console.log("-> 02_ml_training_patch.sql skipped (--skip-ml). Forecasts will have no history.");
    } else {
      console.log("   (the ML history patch inserts ~437,000 rows; this takes 1-3 minutes)");
      await runFile(conn, "02_ml_training_patch.sql");
    }
  }

  await conn.query(`USE \`${DB_NAME}\``);
  for (const file of ["03_appointments.sql", "04_app_tables.sql", "05_complete_demo_data.sql"]) {
    await runFile(conn, file);
  }
  await conn.end();

  await require("./seedUsers").seed();
  await require("./refreshDemo").refresh();

  console.log("\nDatabase is ready.  Next:  npm start");
  process.exit(0);
}

main().catch(error => {
  console.error("\nSetup failed:", error.message);
  if (error.code === "ER_ACCESS_DENIED_ERROR") console.error("Check DB_USER / DB_PASSWORD in backend/.env");
  if (error.code === "ECONNREFUSED") console.error("MySQL is not running or DB_HOST / DB_PORT are wrong.");
  process.exit(1);
});
