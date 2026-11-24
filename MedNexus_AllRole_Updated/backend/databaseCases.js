
const pool = require("./db");

async function getHospitalCases(hospitalId) {
  if (!Number.isInteger(hospitalId) || hospitalId <= 0) {
    throw new Error("hospitalId must be a positive integer");
  }

  const [rows] = await pool.execute(
    `SELECT
       ec.case_id AS id,
       pp.full_name AS patientName,
       ec.arrival_time_units AS arrivalTime,
       ec.burst_time AS burstTime,
       ec.priority,
       ec.triage_level AS triageLevel,
       ec.remaining_time AS remainingTime,
       ec.process_state AS state
     FROM emergency_cases ec
     LEFT JOIN patient_profiles pp
       ON ec.patient_id = pp.patient_id
     WHERE ec.hospital_id = ?
       AND ec.process_state IN ('NEW', 'Ready')
     ORDER BY ec.arrival_time_units, ec.case_id`,
    [hospitalId]
  );

  return rows.map(row => ({
    ...row,
    id: Number(row.id),
    arrivalTime: Number(row.arrivalTime),
    burstTime: Number(row.burstTime),
    priority: Number(row.priority),
    triageLevel: row.triageLevel,
    remainingTime: Number(row.remainingTime),
    patientName: row.patientName || "Unknown Patient",
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
