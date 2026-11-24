const pool = require("./db");
const { getHospitalCases } = require("./databaseCases");

const { fcfs } = require("./fcfs");
const { priorityScheduling } = require("./priority");
const { sjf } = require("./sjf");
const { roundRobin } = require("./roundRobin");
const { applyAging } = require("./aging");
const { detectStarvation } = require("./starvation");

async function runScheduling({
  hospitalId,
  algorithm,
  timeQuantum = null,
  agingWaitingLimit = null,
  starvationMaxWait = null
}) {
  if (!Number.isInteger(hospitalId) || hospitalId <= 0) {
    throw new Error("Invalid hospitalId");
  }

  const allowedAlgorithms = [
    "FCFS",
    "PRIORITY",
    "SJF",
    "ROUND_ROBIN"
  ];

  if (!allowedAlgorithms.includes(algorithm)) {
    throw new Error("Invalid scheduling algorithm");
  }

  if (
    algorithm === "ROUND_ROBIN" &&
    (!Number.isInteger(timeQuantum) || timeQuantum <= 0)
  ) {
    throw new Error(
      "Round Robin requires a positive integer timeQuantum"
    );
  }

  const cases = await getHospitalCases(hospitalId);

  if (cases.length === 0) {
    return {
      runId: null,
      algorithm,
      results: []
    };
  }

  for (const [label, value] of [["agingWaitingLimit", agingWaitingLimit], ["starvationMaxWait", starvationMaxWait]]) {
    if (value !== null && value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new Error(`${label} must be a positive integer`);
    }
  }

  const processes = cases.map(process => ({
  ...process,
  originalPriority: process.priority,
  state: "NEW",
  remainingTime: process.burstTime
}));

  let results;

  switch (algorithm) {
    case "FCFS":
      results = fcfs(processes);
      break;



case "PRIORITY": {
  const waitingLimit = agingWaitingLimit ?? 5;
  const maxWaitingTime = starvationMaxWait ?? 10;

  results = priorityScheduling(
    processes,
    waitingLimit,
    maxWaitingTime
  );

  break;
}



    case "SJF":
      results = sjf(processes);
      break;

    case "ROUND_ROBIN":
      results = roundRobin(processes, timeQuantum);
      break;
  }

  const connection = await pool.getConnection();
  let runId;

  try {
    await connection.beginTransaction();

    const [run] = await connection.execute(
      `INSERT INTO scheduling_runs
       (hospital_id, algorithm, time_quantum,
        aging_waiting_limit, starvation_max_wait,
        simulation_start, simulation_unit, run_status)
       VALUES (?, ?, ?, ?, ?, NOW(), 'MINUTE', 'RUNNING')`,
      [
        hospitalId,
        algorithm,
        algorithm === "ROUND_ROBIN" ? timeQuantum : null,
        algorithm === "PRIORITY" ? (agingWaitingLimit ?? 5) : null,
        algorithm === "PRIORITY" ? (starvationMaxWait ?? 10) : null
      ]
    );

    runId = run.insertId;

    for (let i = 0; i < results.length; i++) {
      const process = results[i];

      await connection.execute(
        `INSERT INTO scheduling_results
         (run_id, case_id, execution_order,
          start_time_units, completion_time_units,
          turnaround_time, waiting_time, response_time,
          priority_at_execution, final_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Completed')`,
        [
          runId,
          process.id,
          i + 1,
          process.startTime,
          process.completionTime,
          process.turnaroundTime,
          process.waitingTime,
          process.responseTime,
          process.priority
        ]
      );
    }

    await connection.execute(
      `UPDATE scheduling_runs
       SET run_status = 'COMPLETED'
       WHERE run_id = ?`,
      [runId]
    );

    await connection.commit();

    return {
      runId,
      algorithm,
      results
    };
  } catch (error) {
    await connection.rollback();

    if (runId) {
      await pool.execute(
        `UPDATE scheduling_runs
         SET run_status = 'FAILED'
         WHERE run_id = ?`,
        [runId]
      );
    }

    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { runScheduling };