const pool = require("./db");

// The seed data and ML patch measure arrival_time_units in minutes since this moment.
const SIM_EPOCH = "2026-10-01 00:00:00";

// Current simulation time in minutes, using the database clock so it matches NOW().
async function nowUnits(conn = pool) {
  const [[row]] = await conn.query(
    "SELECT TIMESTAMPDIFF(MINUTE, ?, NOW()) AS units",
    [SIM_EPOCH]
  );
  return Math.max(0, Number(row.units));
}

module.exports = { SIM_EPOCH, nowUnits };
