const buffer = [];
const bufferSize = 5;

function produceCase(caseItem) {
  if (buffer.length >= bufferSize) {
    return {
      success: false,
      message: "Queue is full"
    };
  }

  buffer.push(caseItem);

  return {
    success: true,
    message: "Emergency case added to queue"
  };
}

function consumeCase() {
  if (buffer.length === 0) {
    return {
      success: false,
      message: "Queue is empty",
      item: null
    };
  }

  return {
    success: true,
    message: "Emergency case removed from queue",
    item: buffer.shift()
  };
}

function getBuffer() {
  return [...buffer];
}

function clearBuffer() {
  buffer.length = 0;
}

module.exports = {
  produceCase,
  consumeCase,
  getBuffer,
  clearBuffer,
  bufferSize
};