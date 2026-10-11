const pool = require("./db");
const { runScheduling } = require("./schedulerService");

async function main() {
  try {
    const result = await runScheduling({
      hospitalId: 1,
      algorithm: "FCFS"
    });

    console.log("Scheduling run ID:", result.runId);
    console.table(result.results);
  } catch (error) {
    console.error(error.message);
  } finally {
    await pool.end();
  }
}

main();