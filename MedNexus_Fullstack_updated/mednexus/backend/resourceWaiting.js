const waitingCases = [];

function addWaitingCase(caseItem) {
  if (!caseItem) {
    throw new Error("caseItem is required");
  }

  waitingCases.push(caseItem);
  return waitingCases.length;
}

function getWaitingCases() {
  return [...waitingCases];
}

function removeWaitingCase(caseId) {
  const index = waitingCases.findIndex(
    item => String(item.id) === String(caseId)
  );

  if (index === -1) {
    return null;
  }

  return waitingCases.splice(index, 1)[0];
}

function clearWaitingCases() {
  waitingCases.length = 0;
}

module.exports = {
  addWaitingCase,
  getWaitingCases,
  removeWaitingCase,
  clearWaitingCases
};