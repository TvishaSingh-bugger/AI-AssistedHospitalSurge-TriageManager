
function applyAging(processes, currentTime, waitingLimit) {
  if (!Number.isFinite(currentTime) || currentTime < 0) {
    throw new Error("currentTime must be non-negative");
  }

  if (!Number.isFinite(waitingLimit) || waitingLimit <= 0) {
    throw new Error("waitingLimit must be positive");
  }

  return processes.map(process => {
    const updated = { ...process };

    const isReady =
      updated.state === "Ready" ||
      updated.state === "NEW";

    if (!isReady) {
      return updated;
    }

    const lastAgingTime =
      updated.lastAgingTime ?? updated.arrivalTime;

    const timeSinceAging = currentTime - lastAgingTime;

    if (
      timeSinceAging >= waitingLimit &&
      updated.priority < 5
    ) {
      updated.priority = Math.min(
        5,
        updated.priority + Math.floor(timeSinceAging / waitingLimit)
      );

      updated.lastAgingTime =
        lastAgingTime +
        Math.floor(timeSinceAging / waitingLimit) * waitingLimit;
    }

    return updated;
  });
}

module.exports = { applyAging };
