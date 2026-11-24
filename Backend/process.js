function createProcess(id, arrivalTime, burstTime, priority = 3) {
  if (id === undefined || id === null) {
    throw new Error("id is required");
  }

  if (!Number.isInteger(arrivalTime) || arrivalTime < 0) {
    throw new Error("arrivalTime must be a non-negative integer");
  }

  if (!Number.isInteger(burstTime) || burstTime <= 0) {
    throw new Error("burstTime must be a positive integer");
  }

  if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
    throw new Error("priority must be between 1 and 5");
  }

  return {
    id,
    arrivalTime,
    burstTime,
    priority,
    remainingTime: burstTime,
    state: "NEW",
    startTime: null,
    completionTime: null,
    turnaroundTime: null,
    waitingTime: null,
    responseTime: null
  };
}

module.exports = { createProcess };