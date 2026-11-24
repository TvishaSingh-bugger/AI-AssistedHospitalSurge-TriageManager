const { applyAging } = require("./aging");

function priorityScheduling(
  processes,
  agingWaitingLimit = 5,
  maxWaitingTime = 10
) {
  const pending = processes.map(process => ({
    ...process,
    remainingTime: process.remainingTime ?? process.burstTime,
    state: process.state ?? "NEW",
    originalPriority: process.originalPriority ?? process.priority,
    lastAgingTime: process.arrivalTime,
    starvationWarning: false
  }));

  const completed = [];
  let time = 0;

  while (pending.length > 0) {
    const available = pending.filter(
      process => process.arrivalTime <= time
    );

    if (available.length === 0) {
      time = Math.min(...pending.map(process => process.arrivalTime));
      continue;
    }
    for (const process of available) {
      const waitingTime = time - process.arrivalTime;

      if (waitingTime >= maxWaitingTime) {
        process.starvationWarning = true;
      }
    }
    const waitingProcesses = pending.filter(
      process =>
        process.arrivalTime <= time &&
        process.state !== "Running"
    );

    const aged = applyAging(
      waitingProcesses.map(process => ({
        ...process,
        state: "Ready"
      })),
      time,
      agingWaitingLimit
    );

    for (const process of pending) {
      const updated = aged.find(item => item.id === process.id);

      if (updated) {
        process.priority = updated.priority;
        process.lastAgingTime = updated.lastAgingTime;
      }
    }

    available.sort(
      (a, b) =>
        b.priority - a.priority ||
        a.arrivalTime - b.arrivalTime
    );

    const process = available[0];
    const index = pending.indexOf(process);

    process.state = "Running";
    process.startTime = time;
    process.responseTime = time - process.arrivalTime;
    process.waitingTime = process.startTime - process.arrivalTime;
    time += process.burstTime;

    process.remainingTime = 0;
    process.completionTime = time;
    process.turnaroundTime =
      process.completionTime - process.arrivalTime;
    process.state = "Completed";

    completed.push(process);
    pending.splice(index, 1);
  }

  return completed;
}

module.exports = { priorityScheduling };
