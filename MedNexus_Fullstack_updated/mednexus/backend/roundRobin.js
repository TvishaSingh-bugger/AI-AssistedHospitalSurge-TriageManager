function roundRobin(processes, timeQuantum) {
  if (!Number.isInteger(timeQuantum) || timeQuantum <= 0) {
    throw new Error("timeQuantum must be a positive integer");
  }

  const jobs = processes
    .map((p, index) => ({
      ...p,
      originalIndex: index,
      remainingTime: p.remainingTime ?? p.burstTime,
      state: "NEW",
      startTime: null,
      completionTime: null,
      waitingTime: 0,
      responseTime: null
    }))
    .sort((a, b) =>
      a.arrivalTime - b.arrivalTime ||
      a.originalIndex - b.originalIndex
    );

  const readyQueue = [];
  const completed = [];
  let time = 0;
  let next = 0;

  while (completed.length < jobs.length) {
    while (
      next < jobs.length &&
      jobs[next].arrivalTime <= time
    ) {
      jobs[next].state = "Ready";
      readyQueue.push(jobs[next]);
      next++;
    }

    if (readyQueue.length === 0) {
      if (next < jobs.length) {
        time = Math.max(time, jobs[next].arrivalTime);
        continue;
      }
      break;
    }

    const process = readyQueue.shift();

    process.state = "Running";

    if (process.startTime === null) {
      process.startTime = time;
      process.responseTime = time - process.arrivalTime;
    }

    const executionTime = Math.min(
      timeQuantum,
      process.remainingTime
    );

    time += executionTime;
    process.remainingTime -= executionTime;

    while (
      next < jobs.length &&
      jobs[next].arrivalTime <= time
    ) {
      jobs[next].state = "Ready";
      readyQueue.push(jobs[next]);
      next++;
    }

    if (process.remainingTime === 0) {
      process.completionTime = time;
      process.turnaroundTime =
        time - process.arrivalTime;
      process.waitingTime =
        process.turnaroundTime - process.burstTime;
      process.state = "Completed";
      completed.push(process);
    } else {
      process.state = "Ready";
      readyQueue.push(process);
    }
  }

  return completed
    .sort((a, b) =>
      a.completionTime - b.completionTime ||
      a.originalIndex - b.originalIndex
    )
    .map(({ originalIndex, ...process }) => process);
}

module.exports = { roundRobin };