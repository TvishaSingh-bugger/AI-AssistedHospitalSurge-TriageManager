function sjf(processes) {
  const pending = processes.map(p => ({
    ...p,
    remainingTime: p.remainingTime ?? p.burstTime,
    state: p.state ?? "NEW"
  }));

  const completed = [];
  let time = 0;

  while (pending.length > 0) {
    const available = pending
      .filter(p => p.arrivalTime <= time)
      .sort((a, b) =>
        a.burstTime - b.burstTime ||
        a.arrivalTime - b.arrivalTime
      );

    if (available.length === 0) {
      time = Math.min(...pending.map(p => p.arrivalTime));
      continue;
    }

    const process = available[0];
    const index = pending.indexOf(process);

    process.state = "Running";
    process.startTime = time;
    process.responseTime = time - process.arrivalTime;
    process.waitingTime = time - process.arrivalTime;

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

module.exports = { sjf };