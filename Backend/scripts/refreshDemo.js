// Makes the supplied sample queue "current": the seed cases that are still NEW were created
// for 9-12 October, so their waiting time (used by aging / starvation detection) would be weeks.
// This moves their arrival to the last 1-25 minutes so the scheduler demo behaves sensibly.
// Only touches NEW cases older than one day; idempotent.   Run any time:  npm run refresh-demo
const pool = require("../db");
const { SIM_EPOCH } = require("../simClock");

async function refresh() {
  const [result] = await pool.query(
    `UPDATE emergency_cases
     SET arrival_time = NOW() - INTERVAL (1 + MOD(case_id, 25)) MINUTE,
         arrival_time_units = GREATEST(0, TIMESTAMPDIFF(MINUTE, ?, NOW()) - (1 + MOD(case_id, 25)))
     WHERE process_state = 'NEW' AND arrival_time < NOW() - INTERVAL 1 DAY`,
    [SIM_EPOCH]
  );
  console.log(`-> demo queue refreshed: ${result.affectedRows} waiting case(s) re-timed to "just now"`);
}

module.exports = { refresh };

if (require.main === module) {
  refresh().then(() => process.exit(0)).catch(error => {
    console.error("Refresh failed:", error.message);
    process.exit(1);
  });
}
