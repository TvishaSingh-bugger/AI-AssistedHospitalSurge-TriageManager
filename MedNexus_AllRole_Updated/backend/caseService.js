const crypto = require("crypto");
const pool = require("./db");
const { nowUnits } = require("./simClock");

// Higher number = served first.
const PRIORITY = { Critical: 5, High: 4, Medium: 3, Low: 1 };

const NEED_REQUIREMENTS = {
  None: [],
  ICU: [["ICU_BED", 1]],
  "ICU + Ventilator": [["ICU_BED", 1], ["VENTILATOR", 1]],
  Oxygen: [["OXYGEN_CYLINDER", 1]],
  Observation: [["GENERAL_BED", 1]]
};

const ALLOWED_RESOURCES = new Set([
  "ICU_BED",
  "GENERAL_BED",
  "VENTILATOR",
  "OXYGEN_CYLINDER",
  "OXYGEN_SUPPLY",
  "BLOOD_UNIT"
]);

function needFromRequirements(types) {
  if (types.includes("ICU_BED") && types.includes("VENTILATOR"))
    return "ICU + Ventilator";

  if (types.includes("ICU_BED")) return "ICU";

  if (types.includes("OXYGEN_CYLINDER") || types.includes("OXYGEN_SUPPLY"))
    return "Oxygen";

  if (types.includes("GENERAL_BED")) return "Observation";

  return "None";
}

const code = prefix =>
  `${prefix}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

async function createPatient(
  conn,
  { hospitalId, fullName, age = null, sex = null, userId = null }
) {
  const [result] = await conn.query(
    `INSERT INTO patients
     (hospital_id, patient_code, age, sex, registered_at, is_synthetic)
     VALUES (?, ?, ?, ?, NOW(), 0)`,
    [hospitalId, code("PT"), age, sex]
  );

  if (fullName) {
    await conn.query(
      "INSERT INTO patient_profiles (patient_id, user_id, full_name) VALUES (?, ?, ?)",
      [result.insertId, userId, fullName]
    );
  }

  return result.insertId;
}

async function patientForUser(conn, userId, hospitalId) {
  const [rows] = await conn.query(
    `SELECT pp.patient_id
     FROM patient_profiles pp
     JOIN patients p ON p.patient_id = pp.patient_id
     WHERE pp.user_id = ? AND p.hospital_id = ?
     LIMIT 1`,
    [userId, hospitalId]
  );

  if (rows.length) return Number(rows[0].patient_id);

  const [[user]] = await conn.query(
    "SELECT full_name FROM app_users WHERE user_id = ?",
    [userId]
  );

  const [health] = await conn.query(
    "SELECT age, sex FROM user_health_profiles WHERE user_id = ?",
    [userId]
  );

  return createPatient(conn, {
    hospitalId,
    fullName: user.full_name,
    age: health[0]?.age ?? null,
    sex: health[0]?.sex ?? null,
    userId
  });
}

// Registers an emergency case + queue + resource requirements transactionally.
async function createEmergencyCase({
  hospitalId,
  patientId,
  caseType,
  triageLevel,
  need = "None",
  resourceRequirements = null,
  burstTime = 5
}) {
  if (!PRIORITY[triageLevel]) {
    throw Object.assign(new Error("Invalid triage level"), { status: 400 });
  }

  let requirements;

  // New multi-resource format
  if (resourceRequirements !== null) {
    if (!Array.isArray(resourceRequirements)) {
      throw Object.assign(
        new Error("Resource requirements must be an array"),
        { status: 400 }
      );
    }

    requirements = resourceRequirements.map(item => {
      const resourceType = String(item.resource_type || "");
      const quantity = Number(item.quantity);

      if (!ALLOWED_RESOURCES.has(resourceType)) {
        throw Object.assign(new Error("Invalid resource type"), { status: 400 });
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw Object.assign(
          new Error("Resource quantity must be a positive integer"),
          { status: 400 }
        );
      }

      return { resourceType, quantity };
    });

    // Merge duplicate resource types
    const merged = new Map();

    for (const r of requirements) {
      merged.set(
        r.resourceType,
        (merged.get(r.resourceType) || 0) + r.quantity
      );
    }

    requirements = [...merged.entries()].map(([resourceType, quantity]) => ({
      resourceType,
      quantity
    }));
  } else {
    // Backward-compatible legacy format
    if (!NEED_REQUIREMENTS[need]) {
      throw Object.assign(new Error("Invalid resource need"), { status: 400 });
    }

    requirements = NEED_REQUIREMENTS[need].map(([resourceType, quantity]) => ({
      resourceType,
      quantity
    }));
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const units = await nowUnits(conn);
    const caseCode = code("EC");

    const [result] = await conn.query(
      `INSERT INTO emergency_cases
       (hospital_id, patient_id, case_code, case_type, triage_level, priority,
        arrival_time, arrival_time_units, burst_time, remaining_time, process_state)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, 'NEW')`,
      [
        hospitalId,
        patientId,
        caseCode,
        caseType,
        triageLevel,
        PRIORITY[triageLevel],
        units,
        burstTime,
        burstTime
      ]
    );

    const caseId = result.insertId;

    await conn.query(
      `INSERT INTO queue_entries
       (hospital_id, case_id, queue_type, queue_position, queue_status)
       SELECT ?, ?, 'PRODUCER_BUFFER',
              COALESCE(MAX(queue_position), 0) + 1, 'QUEUED'
       FROM queue_entries
       WHERE hospital_id = ? AND queue_type = 'PRODUCER_BUFFER'`,
      [hospitalId, caseId, hospitalId]
    );

    for (const r of requirements) {
      await conn.query(
        `INSERT INTO case_resource_requirements
         (case_id, resource_type, required_quantity)
         VALUES (?, ?, ?)`,
        [caseId, r.resourceType, r.quantity]
      );
    }

    await conn.query(
      `INSERT INTO system_events
       (hospital_id, case_id, event_type, event_message)
       VALUES (?, ?, 'CASE_QUEUED', ?)`,
      [hospitalId, caseId, `Case ${caseCode} queued (${triageLevel})`]
    );

    await conn.commit();

    return {
      case_id: caseId,
      case_code: caseCode,
      process_state: "NEW",
      priority: PRIORITY[triageLevel],
      resource_requirements: requirements
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  PRIORITY,
  NEED_REQUIREMENTS,
  needFromRequirements,
  createPatient,
  patientForUser,
  createEmergencyCase
};