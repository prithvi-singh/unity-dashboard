/**
 * check-schema.js
 * Dumps the full schema of the Azure SQL (UnityDb) database.
 * Run: node check-schema.js
 * Requires: npm install mssql dotenv
 *
 * Output is written to both the console and schema-dump.txt.
 */

require("dotenv").config();
const sql = require("mssql");
const fs = require("fs");
const path = require("path");

const OUTPUT_FILE = path.join(__dirname, "schema-dump.txt");
const outStream = fs.createWriteStream(OUTPUT_FILE, { encoding: "utf8" });

function tee(...args) {
  const line = args.join(" ");
  console.log(line);
  outStream.write(line + "\n");
}

function teeError(...args) {
  const line = args.join(" ");
  console.error(line);
  outStream.write(line + "\n");
}

function teeTable(rows) {
  if (!rows || rows.length === 0) {
    tee("  (no rows returned)");
    return;
  }
  console.table(rows);
  const keys = Object.keys(rows[0]);
  const colWidths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length))
  );
  const header = keys.map((k, i) => k.padEnd(colWidths[i])).join("  |  ");
  const divider = colWidths.map((w) => "-".repeat(w)).join("--+--");
  outStream.write("  " + header + "\n");
  outStream.write("  " + divider + "\n");
  for (const row of rows) {
    const line = keys
      .map((k, i) => String(row[k] ?? "").padEnd(colWidths[i]))
      .join("  |  ");
    outStream.write("  " + line + "\n");
  }
  outStream.write("\n");
}

const config = {
  server: process.env.DB_SERVER || "mombelief-unity.database.windows.net",
  database: process.env.DB_NAME || "UnityDb",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || "1433", 10),
  options: {
    encrypt: true,           // required for Azure SQL
    trustServerCertificate: false,
  },
  connectionTimeout: 30000,
  requestTimeout: 30000,
};

function printSeparator(label) {
  const line = "=".repeat(60);
  tee(`\n${line}`);
  tee(`  ${label}`);
  tee(`${line}\n`);
}

function printRows(rows) {
  teeTable(rows);
}

async function runQuery(pool, label, query) {
  printSeparator(label);
  try {
    const result = await pool.request().query(query);
    printRows(result.recordset);
  } catch (err) {
    teeError(`  ERROR in [${label}]: ${err.message}`);
  }
}

async function main() {
  let pool;

  tee(`Schema dump started: ${new Date().toISOString()}`);
  tee(`Output file: ${OUTPUT_FILE}\n`);

  try {
    tee("Connecting to Azure SQL...");
    pool = await sql.connect(config);
    tee(`Connected to: ${config.server} / ${config.database}\n`);
  } catch (err) {
    teeError("FATAL: Could not connect to the database.");
    teeError(err.message);
    outStream.end();
    process.exit(1);
  }

  // ----------------------------------------------------------------
  // Query 1 — List all tables
  // ----------------------------------------------------------------
  await runQuery(
    pool,
    "Query 1 — All Tables",
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`
  );

  // ----------------------------------------------------------------
  // Query 2 — All columns with data types
  // ----------------------------------------------------------------
  await runQuery(
    pool,
    "Query 2 — All Columns with Data Types",
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
     FROM INFORMATION_SCHEMA.COLUMNS
     ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );

  // ----------------------------------------------------------------
  // Query 3 — First 3 rows of tables containing "audit" or "log"
  // ----------------------------------------------------------------
  printSeparator('Query 3 — Sample Rows from "audit" / "log" Tables');
  try {
    const tableResult = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
        AND (TABLE_NAME LIKE '%audit%' OR TABLE_NAME LIKE '%log%')
      ORDER BY TABLE_NAME
    `);

    const tables = tableResult.recordset.map((r) => r.TABLE_NAME);

    if (tables.length === 0) {
      tee('  (no tables found matching "audit" or "log")');
    } else {
      for (const table of tables) {
        tee(`\n  --- Table: [${table}] ---`);
        try {
          const sample = await pool
            .request()
            .query(`SELECT TOP 3 * FROM [${table}]`);
          printRows(sample.recordset);
        } catch (err) {
          teeError(`  ERROR sampling [${table}]: ${err.message}`);
        }
      }
    }
  } catch (err) {
    teeError(`  ERROR in Query 3: ${err.message}`);
  }

  // ----------------------------------------------------------------
  // Query 4 — First 3 rows of tables containing "user"
  // ----------------------------------------------------------------
  printSeparator('Query 4 — Sample Rows from "user" Tables');
  try {
    const tableResult = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
        AND TABLE_NAME LIKE '%user%'
      ORDER BY TABLE_NAME
    `);

    const tables = tableResult.recordset.map((r) => r.TABLE_NAME);

    if (tables.length === 0) {
      tee('  (no tables found matching "user")');
    } else {
      for (const table of tables) {
        tee(`\n  --- Table: [${table}] ---`);
        try {
          const sample = await pool
            .request()
            .query(`SELECT TOP 3 * FROM [${table}]`);
          printRows(sample.recordset);
        } catch (err) {
          teeError(`  ERROR sampling [${table}]: ${err.message}`);
        }
      }
    }
  } catch (err) {
    teeError(`  ERROR in Query 4: ${err.message}`);
  }

  // ----------------------------------------------------------------
  await pool.close();
  tee(`\nDone. Full output saved to: ${OUTPUT_FILE}`);
  outStream.end();
}

main().catch((err) => {
  teeError("Unhandled error:", err.message);
  outStream.end();
  process.exit(1);
});
