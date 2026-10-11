
const readline = require("readline");
const pool = require("./db");
const { runScheduling } = require("./schedulerService");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve =>
    rl.question(question, answer => resolve(answer.trim()))
  );
}

async function main() {
  try {
    const algorithms = {
      "1": "FCFS",
      "2": "SJF",
      "3": "PRIORITY",
      "4": "ROUND_ROBIN"
    };

    console.log("\n===== HOSPITAL CPU SCHEDULER =====");
    console.log("1. FCFS");
    console.log("2. SJF");
    console.log("3. Priority Scheduling");
    console.log("4. Round Robin");
    console.log("5. Compare all algorithms");
    console.log("6. Exit");

    const choice = await ask("\nChoose an option: ");

    if (choice === "6") return;

    if (!["1", "2", "3", "4", "5"].includes(choice)) {
      console.log("Invalid choice.");
      return;
    }

    const hospitalInput = await ask("Hospital ID (default 1): ");
    const hospitalId = hospitalInput === "" ? 1 : Number(hospitalInput);

    if (!Number.isInteger(hospitalId) || hospitalId <= 0) {
      console.log("Invalid hospital ID.");
      return;
    }

    let selectedAlgorithms =
      choice === "5" ? Object.values(algorithms) : [algorithms[choice]];

    let timeQuantum = null;

    if (selectedAlgorithms.includes("ROUND_ROBIN")) {
      const input = await ask("Enter Round Robin time quantum: ");
      timeQuantum = Number(input);

      if (!Number.isInteger(timeQuantum) || timeQuantum <= 0) {
        console.log("Time quantum must be a positive integer.");
        return;
      }
    }

    const comparison = [];

    for (const algorithm of selectedAlgorithms) {
      console.log(`\n========== ${algorithm} ==========`);

      const result = await runScheduling({
        hospitalId,
        algorithm,
        timeQuantum:
          algorithm === "ROUND_ROBIN" ? timeQuantum : null
      });

      if (!result.results.length) {
        console.log("No hospital cases found.");
        continue;
      }

      const rows = result.results.map((p, index) => ({
        Order: index + 1,
        CaseID: p.id,
        Arrival: p.arrivalTime,
        Burst: p.burstTime,
        Start: p.startTime,
        Completion: p.completionTime,
        Waiting: p.waitingTime,
        Turnaround: p.turnaroundTime,
        Response: p.responseTime
      }));

      console.log("Run ID:", result.runId);
      console.table(rows);

      const count = result.results.length;
      const avgWaiting =
        result.results.reduce((sum, p) => sum + p.waitingTime, 0) / count;
      const avgTurnaround =
        result.results.reduce((sum, p) => sum + p.turnaroundTime, 0) / count;
      const avgResponse =
        result.results.reduce((sum, p) => sum + p.responseTime, 0) / count;

      console.log("Average waiting time:", avgWaiting.toFixed(2));
      console.log("Average turnaround time:", avgTurnaround.toFixed(2));
      console.log("Average response time:", avgResponse.toFixed(2));

      comparison.push({
        Algorithm: algorithm,
        "Average WT": avgWaiting.toFixed(2),
        "Average TAT": avgTurnaround.toFixed(2),
        "Average RT": avgResponse.toFixed(2)
      });
    }

    if (comparison.length > 1) {
      console.log("\n===== ALGORITHM COMPARISON =====");
      console.table(comparison);
    }
  } catch (error) {
    console.error("Scheduling error:", error.message);
  } finally {
    rl.close();
    await pool.end();
  }
}

main();
