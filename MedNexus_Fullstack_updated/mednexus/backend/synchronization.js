let lockQueue = Promise.resolve();

async function accessResource(callback) {
  if (typeof callback !== "function") {
    throw new TypeError("callback must be a function");
  }

  let release;

  const currentLock = new Promise(resolve => {
    release = resolve;
  });

  const previousLock = lockQueue;
  lockQueue = previousLock.then(() => currentLock);

  await previousLock;

  try {
    return await callback();
  } finally {
    release();
  }
}

module.exports = { accessResource };