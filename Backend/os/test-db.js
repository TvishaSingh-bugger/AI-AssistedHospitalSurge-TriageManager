const pool = require("./db");

async function main() {
  try {
    const [connectionInfo] = await pool.query(
      "SELECT DATABASE() AS databaseName, VERSION() AS mysqlVersion"
    );

    console.log("MySQL connection successful:");
    console.table(connectionInfo);

    const [caseCount] = await pool.query(
      "SELECT COUNT(*) AS total FROM emergency_cases"
    );

    const [resourceCount] = await pool.query(
      "SELECT COUNT(*) AS total FROM resource_inventory"
    );

    console.log(
      "Emergency cases:",
      caseCount[0].total
    );

    console.log(
      "Resource inventory rows:",
      resourceCount[0].total
    );
  } catch (error) {
    console.error("Database test failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();