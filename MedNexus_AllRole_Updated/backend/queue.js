const readyQueue = [];

function addProcess(process) {
  if (!process) {
    throw new Error("process is required");
  }

  readyQueue.push(process);
  return readyQueue.length;
}

function getQueue() {
  return [...readyQueue];
}

function removeProcess() {
  return readyQueue.length > 0
    ? readyQueue.shift()
    : null;
}

function clearQueue() {
  readyQueue.length = 0;
}

module.exports = {
  addProcess,
  getQueue,
  removeProcess,
  clearQueue
};