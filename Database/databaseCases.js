const pool = require("./db");

async function getHospitalCases(hospitalId) {
  if (!Number.isInteger(hospitalId) || hospitalId <= 0) {
    throw new Error("hospitalId must be a positive integer");
  }

  const [rows] = await pool.execute(
    `SELECT
       case_id AS id,
       arrival_time_units AS arrivalTime,
       burst_time AS burstTime,
       priority,
       remaining_time AS remainingTime,
       process_state AS state
     FROM emergency_cases
     WHERE hospital_id = ?
       AND process_state IN ('NEW', 'Ready')
     ORDER BY arrival_time_units, case_id`,
    [hospitalId]
  );

  return rows.map(row => ({
    ...row,
    id: Number(row.id),
    arrivalTime: Number(row.arrivalTime),
    burstTime: Number(row.burstTime),
    priority: Number(row.priority),
    remainingTime: Number(row.remainingTime),
    state: row.state
  }));
}

async function getHospitalResources(hospitalId) {
  if (!Number.isInteger(hospitalId) || hospitalId <= 0) {
    throw new Error("hospitalId must be a positive integer");
  }

  const [rows] = await pool.execute(
    `SELECT
       resource_id,
       resource_type,
       blood_group,
       total_quantity,
       available_quantity,
       unit
     FROM resource_inventory
     WHERE hospital_id = ?
     ORDER BY resource_type, blood_group`,
    [hospitalId]
  );

  return rows;
}

module.exports = {
  getHospitalCases,
  getHospitalResources
};