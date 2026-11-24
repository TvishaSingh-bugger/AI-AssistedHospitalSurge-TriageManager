
function detectStarvation(processes, currentTime, maxWaitingTime) {
  if (!Number.isFinite(currentTime) || currentTime < 0) {
    throw new Error("currentTime must be non-negative");
  }

  if (!Number.isFinite(maxWaitingTime) || maxWaitingTime <= 0) {
    throw new Error("maxWaitingTime must be positive");
  }

  return processes
    .filter(process =>
      ["NEW", "Ready", "Waiting"].includes(process.state)
    )
    .map(process => {
      const waitingElapsed = Math.max(
        0,
        currentTime - process.arrivalTime
      );

      return {
        ...process,
        waitingElapsed,
        starvationWarning: waitingElapsed >= maxWaitingTime
      };
    })
    .filter(process => process.starvationWarning);
}

module.exports = { detectStarvation };
