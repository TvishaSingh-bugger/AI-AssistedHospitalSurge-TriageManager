const { accessResource } = require("./synchronization");

async function criticalSection(allocationFunction) {
  if (typeof allocationFunction !== "function") {
    throw new TypeError(
      "allocationFunction must be a function"
    );
  }

  return accessResource(allocationFunction);
}

module.exports = { criticalSection };