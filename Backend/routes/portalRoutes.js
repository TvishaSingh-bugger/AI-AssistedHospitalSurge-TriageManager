// Frontend-facing API ("adapter"): returns data already shaped for the React app
// (hospital resource tuples, unified patient records) and holds the portal workflows
// (patient emergency/appointment booking, walk-ins, status changes, prescriptions).
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth, canActOnHospital } = require("../auth");
const { completeCase, startCase } = require("../dispatcher");
const {
  NEED_REQUIREMENTS, PRIORITY, needFromRequirements,
  createPatient, patientForUser, createEmergencyCase
} = require("../caseService");

const STAFF_ROLES = ["staff", "doctor", "admin"];
const APPT_STATUSES = ["Booked", "Confirmed", "In Progress", "Completed", "Cancelled"];
const CASE_STATES = ["Ready", "Running", "Waiting", "Completed", "Cancelled"];
const TERMINAL = ["Completed", "Cancelled"];
const RESOURCE_KEYS = {
  ICU_BED: "icu",
  VENTILATOR: "vent",
  OXYGEN_CYLINDER: "oxy",
  GENERAL_BED: "beds",
  BLOOD_UNIT: "blood"
};

router.use(requireAuth());

const positiveInt = value => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const fail = (res, error, fallback) => {
  if (error.status) return res.status(error.status).json({ success: false, message: error.message });
  console.error(fallback + ":", error.message);
  return res.status(500).json({ success: false, message: fallback });
};

const bad = (res, message, status = 400) =>
  res.status(status).json({ success: false, message });

// ---------------------------------------------------------------- record helpers

async function fetchCaseRecords(whereSql, params, limit, order = "ec.priority DESC, ec.arrival_time ASC") {
  const [rows] = await pool.query(
    `SELECT ec.case_id, ec.case_code, ec.hospital_id, h.hospital_name, ec.patient_id, ec.case_type,
            ec.triage_level, ec.arrival_time, ec.process_state,
            p.age, p.sex, p.patient_code, pp.full_name
     FROM emergency_cases ec
     JOIN patients p ON p.patient_id = ec.patient_id
     JOIN hospitals h ON h.hospital_id = ec.hospital_id
     LEFT JOIN patient_profiles pp ON pp.patient_id = ec.patient_id
     WHERE ${whereSql}
     ORDER BY ${order}
     LIMIT ?`,
    [...params, limit]
  );

  if (!rows.length) return [];

  const [reqs] = await pool.query(
    "SELECT case_id, resource_type FROM case_resource_requirements WHERE case_id IN (?)",
    [rows.map(r => r.case_id)]
  );

  const byCase = new Map();

  for (const r of reqs) {
    if (!byCase.has(Number(r.case_id))) {
      byCase.set(Number(r.case_id), []);
    }
    byCase.get(Number(r.case_id)).push(r.resource_type);
  }

  return rows.map(r => ({
    key: `C${r.case_id}`,
    kind: "case",
    id: Number(r.case_id),
    code: r.case_code,
    patient_id: Number(r.patient_id),
    name: r.full_name || r.patient_code,
    age: r.age,
    sex: r.sex,
    hid: r.hospital_id,
    hospital_name: r.hospital_name,
    type: "Emergency",
    severity: r.triage_level,
    need: needFromRequirements(byCase.get(Number(r.case_id)) || []),
    reason: r.case_type,
    dept: "Emergency",
    status: r.process_state,
    time: new Date(r.arrival_time).getTime()
  }));
}

async function fetchApptRecords(whereSql, params, limit) {
  const [rows] = await pool.query(
    `SELECT a.appointment_id, a.patient_id, a.hospital_id, h.hospital_name, a.doctor_id,
            a.appointment_date, a.reason, a.appointment_status,
            p.age, p.sex, p.patient_code, pp.full_name, ms.staff_name
     FROM appointments a
     JOIN patients p ON p.patient_id = a.patient_id
     JOIN hospitals h ON h.hospital_id = a.hospital_id
     JOIN medical_staff ms ON ms.staff_id = a.doctor_id
     LEFT JOIN patient_profiles pp ON pp.patient_id = a.patient_id
     WHERE ${whereSql}
     ORDER BY a.appointment_date DESC
     LIMIT ?`,
    [...params, limit]
  );

  return rows.map(r => ({
    key: `A${r.appointment_id}`,
    kind: "appt",
    id: Number(r.appointment_id),
    code: `APT-${r.appointment_id}`,
    patient_id: Number(r.patient_id),
    name: r.full_name || r.patient_code,
    age: r.age,
    sex: r.sex,
    hid: r.hospital_id,
    hospital_name: r.hospital_name,
    type: "Regular",
    severity: "Low",
    need: "None",
    reason: r.reason || "Consultation",
    dept: r.staff_name,
    doctor_id: r.doctor_id,
    status: r.appointment_status,
    time: new Date(r.appointment_date).getTime()
  }));
}

// ---------------------------------------------------------------- hospitals

router.get("/hospitals", async (req, res) => {
  try {
    const [hospitals] = await pool.query(
      `SELECT hospital_id, hospital_name, district, hospital_type, total_beds, hospital_code
       FROM hospitals ORDER BY hospital_name ASC`
    );

    const [inventory] = await pool.query(
      `SELECT resource_id, hospital_id, resource_type, total_quantity, available_quantity
       FROM resource_inventory
       WHERE resource_type IN ('ICU_BED','VENTILATOR','OXYGEN_CYLINDER','GENERAL_BED','BLOOD_UNIT')`
    );

    const [active] = await pool.query(
      `SELECT hospital_id, COUNT(*) AS n FROM emergency_cases
       WHERE process_state NOT IN ('Completed','Cancelled') GROUP BY hospital_id`
    );

    const activeAppts = await pool.query(
      `SELECT hospital_id, COUNT(*) AS n FROM appointments
       WHERE appointment_status IN ('Booked','Confirmed','In Progress') GROUP BY hospital_id`
    ).then(r => r[0]);

    const byHospital = new Map();

    for (const row of inventory) {
      if (!byHospital.has(row.hospital_id)) {
        byHospital.set(row.hospital_id, []);
      }
      byHospital.get(row.hospital_id).push(row);
    }

    const activeMap = new Map();

    for (const a of [...active, ...activeAppts]) {
      activeMap.set(
        a.hospital_id,
        (activeMap.get(a.hospital_id) || 0) + Number(a.n)
      );
    }

    const data = hospitals.map(h => {
      const out = {
        id: h.hospital_id,
        name: h.hospital_name.trim(),
        code: h.hospital_code,
        district: h.district,
        type: h.hospital_type,
        total_beds: h.total_beds,
        icu: [0, 0],
        vent: [0, 0],
        oxy: [0, 0],
        beds: [0, 0],
        blood: [0, 0],
        resource_ids: {},
        active: activeMap.get(h.hospital_id) || 0
      };

      for (const r of byHospital.get(h.hospital_id) || []) {
        const key = RESOURCE_KEYS[r.resource_type];

        out[key] = [
          out[key][0] + Number(r.available_quantity),
          out[key][1] + Number(r.total_quantity)
        ];

        if (!out.resource_ids[key]) {
          out.resource_ids[key] = r.resource_id;
        }
      }

      return out;
    });

    res.json({ success: true, count: data.length, data });
  } catch (error) {
    fail(res, error, "Failed to load hospitals");
  }
});

router.get("/hospitals/:id/doctors", async (req, res) => {
  try {
    const id = positiveInt(req.params.id);
    if (!id) return bad(res, "Invalid hospital ID");

    const [rows] = await pool.query(
      "SELECT staff_id, staff_name FROM medical_staff WHERE hospital_id = ? AND role = 'Doctor' ORDER BY staff_name",
      [id]
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    fail(res, error, "Failed to load doctors");
  }
});

// Unified list of emergency cases + appointments for one hospital.
router.get("/hospitals/:id/records", requireAuth(STAFF_ROLES), async (req, res) => {
  try {
    const id = positiveInt(req.params.id);
    if (!id) return bad(res, "Invalid hospital ID");

    if (!canActOnHospital(req.user, id)) {
      return bad(res, "This is another hospital's data", 403);
    }

    // A doctor only sees appointments booked with THEM; staff/admin see the whole hospital.
    const onlyMine = req.user.role === "doctor" && req.user.sid;

    const [active, finished, appts] = await Promise.all([
      fetchCaseRecords(
        "ec.hospital_id = ? AND ec.process_state NOT IN ('Completed','Cancelled')",
        [id],
        300
      ),

      fetchCaseRecords(
        "ec.hospital_id = ? AND ec.process_state IN ('Completed','Cancelled')",
        [id],
        40,
        "ec.arrival_time DESC"
      ),

      fetchApptRecords(
        onlyMine ? "a.hospital_id = ? AND a.doctor_id = ?" : "a.hospital_id = ?",
        onlyMine ? [id, req.user.sid] : [id],
        200
      )
    ]);

    const data = [...active, ...finished, ...appts];

    res.json({ success: true, count: data.length, data });
  } catch (error) {
    fail(res, error, "Failed to load hospital records");
  }
});

router.get("/hospitals/:id/prescriptions", requireAuth(STAFF_ROLES), async (req, res) => {
  try {
    const id = positiveInt(req.params.id);
    if (!id) return bad(res, "Invalid hospital ID");

    if (!canActOnHospital(req.user, id)) {
      return bad(res, "This is another hospital's data", 403);
    }

    const [rows] = await pool.query(
      `SELECT rx.prescription_id, rx.patient_id, COALESCE(pp.full_name, p.patient_code) AS patient_name,
              rx.doctor_name, rx.medicine, rx.notes, rx.created_at
       FROM prescriptions rx
       JOIN patients p ON p.patient_id = rx.patient_id
       LEFT JOIN patient_profiles pp ON pp.patient_id = rx.patient_id
       WHERE rx.hospital_id = ? ORDER BY rx.created_at DESC LIMIT 100`,
      [id]
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    fail(res, error, "Failed to load prescriptions");
  }
});

router.post("/prescriptions", requireAuth(["doctor"]), async (req, res) => {
  try {
    const patientId = positiveInt(req.body.patient_id);
    const medicine = String(req.body.medicine || "").trim();
    const notes = String(req.body.notes || "").trim();

    if (!patientId || !medicine) {
      return bad(res, "patient_id and medicine are required");
    }

    if (medicine.length > 200 || notes.length > 500) {
      return bad(res, "Medicine or notes too long");
    }

    const [patients] = await pool.query(
      "SELECT hospital_id FROM patients WHERE patient_id = ?",
      [patientId]
    );

    if (!patients.length) return bad(res, "Patient not found", 404);

    if (!canActOnHospital(req.user, patients[0].hospital_id)) {
      return bad(res, "This patient belongs to another hospital", 403);
    }

    const [[doctor]] = await pool.query(
      "SELECT full_name FROM app_users WHERE user_id = ?",
      [req.user.uid]
    );

    const [result] = await pool.query(
      `INSERT INTO prescriptions (hospital_id, patient_id, doctor_user_id, doctor_name, medicine, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        patients[0].hospital_id,
        patientId,
        req.user.uid,
        doctor.full_name,
        medicine,
        notes || null
      ]
    );

    res.status(201).json({
      success: true,
      data: { prescription_id: result.insertId }
    });
  } catch (error) {
    fail(res, error, "Failed to save prescription");
  }
});

// ---------------------------------------------------------------- reports

// Per-hospital totals. Staff/doctors only get their own hospital; admins get every hospital.
router.get("/reports/summary", requireAuth(STAFF_ROLES), async (req, res) => {
  try {
    const only = req.user.role === "admin" ? null : req.user.hid;
    const filter = only ? "WHERE hospital_id = ?" : "";
    const params = only ? [only] : [];

    const [cases] = await pool.query(
      `SELECT hospital_id, COUNT(*) AS total,
              SUM(process_state = 'Completed') AS completed,
              SUM(process_state = 'Cancelled') AS cancelled,
              SUM(process_state NOT IN ('Completed','Cancelled')) AS active
       FROM emergency_cases ${filter} GROUP BY hospital_id`,
      params
    );

    const [appts] = await pool.query(
      `SELECT hospital_id, COUNT(*) AS total,
              SUM(appointment_status = 'Completed') AS completed,
              SUM(appointment_status IN ('Booked','Confirmed','In Progress')) AS active
       FROM appointments ${filter} GROUP BY hospital_id`,
      params
    );

    const map = new Map();

    const slot = id => {
      if (!map.has(id)) {
        map.set(id, {
          hospital_id: id,
          emergency: 0,
          emergency_completed: 0,
          emergency_active: 0,
          regular: 0,
          regular_completed: 0,
          regular_active: 0
        });
      }
      return map.get(id);
    };

    for (const c of cases) {
      const r = slot(c.hospital_id);
      r.emergency = Number(c.total);
      r.emergency_completed = Number(c.completed);
      r.emergency_active = Number(c.active);
    }

    for (const a of appts) {
      const r = slot(a.hospital_id);
      r.regular = Number(a.total);
      r.regular_completed = Number(a.completed);
      r.regular_active = Number(a.active);
    }

    res.json({ success: true, data: [...map.values()] });
  } catch (error) {
    fail(res, error, "Failed to build report");
  }
});

// Rows for the CSV download: current + recent records of one hospital (admin: all hospitals, capped).
router.get("/reports/export", requireAuth(STAFF_ROLES), async (req, res) => {
  try {
    const requested = req.query.hospital_id
      ? positiveInt(req.query.hospital_id)
      : null;

    const hospitalId = req.user.role === "admin" ? requested : req.user.hid;

    if (hospitalId && !canActOnHospital(req.user, hospitalId)) {
      return bad(res, "This is another hospital's data", 403);
    }

    const caseWhere = hospitalId
      ? "ec.hospital_id = ? AND ec.arrival_time >= NOW() - INTERVAL 30 DAY"
      : "ec.process_state NOT IN ('Completed','Cancelled')";

    const apptWhere = hospitalId
      ? "a.hospital_id = ?"
      : "a.appointment_status IN ('Booked','Confirmed','In Progress')";

    const params = hospitalId ? [hospitalId] : [];

    const [cases, appts] = await Promise.all([
      fetchCaseRecords(caseWhere, params, 5000, "ec.arrival_time DESC"),
      fetchApptRecords(apptWhere, params, 5000)
    ]);

    res.json({ success: true, data: [...cases, ...appts] });
  } catch (error) {
    fail(res, error, "Failed to export report");
  }
});

// ---------------------------------------------------------------- resources

router.put("/resources/:id", requireAuth(["staff", "admin"]), async (req, res) => {
  try {
    const id = positiveInt(req.params.id);
    const total = Number(req.body.total_quantity);
    const available = Number(req.body.available_quantity);

    if (!id) return bad(res, "Invalid resource ID");

    if (
      !Number.isSafeInteger(total) || total < 0 ||
      !Number.isSafeInteger(available) || available < 0
    ) {
      return bad(res, "Quantities must be non-negative whole numbers");
    }

    if (available > total) {
      return bad(res, "Available cannot exceed total");
    }

    const [rows] = await pool.query(
      "SELECT hospital_id FROM resource_inventory WHERE resource_id = ?",
      [id]
    );

    if (!rows.length) return bad(res, "Resource not found", 404);

    if (!canActOnHospital(req.user, rows[0].hospital_id)) {
      return bad(res, "This is another hospital's resource", 403);
    }

    await pool.query(
      "UPDATE resource_inventory SET total_quantity = ?, available_quantity = ? WHERE resource_id = ?",
      [total, available, id]
    );

    await pool.query(
      `INSERT INTO resource_history (resource_id, recorded_at, total_quantity, available_quantity, used_quantity, source)
       VALUES (?, NOW(), ?, ?, ?, 'MANUAL')`,
      [id, total, available, total - available]
    );

    res.json({ success: true });
  } catch (error) {
    fail(res, error, "Failed to update resource");
  }
});

// ---------------------------------------------------------------- patient: own data

router.get("/me", requireAuth(["patient"]), async (req, res) => {
  try {
    const uid = req.user.uid;

    const [health] = await pool.query(
      "SELECT * FROM user_health_profiles WHERE user_id = ?",
      [uid]
    );

    const [cases, appts] = await Promise.all([
      fetchCaseRecords(
        "ec.patient_id IN (SELECT patient_id FROM patient_profiles WHERE user_id = ?)",
        [uid],
        100,
        "ec.arrival_time DESC"
      ),

      fetchApptRecords(
        "a.patient_id IN (SELECT patient_id FROM patient_profiles WHERE user_id = ?)",
        [uid],
        100
      )
    ]);

    const [rx] = await pool.query(
      `SELECT rx.prescription_id, h.hospital_name, rx.doctor_name, rx.medicine, rx.notes, rx.created_at
       FROM prescriptions rx
       JOIN hospitals h ON h.hospital_id = rx.hospital_id
       WHERE rx.patient_id IN (SELECT patient_id FROM patient_profiles WHERE user_id = ?)
       ORDER BY rx.created_at DESC`,
      [uid]
    );

    res.json({
      success: true,
      health: health[0] || {},
      records: [...cases, ...appts],
      prescriptions: rx
    });
  } catch (error) {
    fail(res, error, "Failed to load your data");
  }
});

router.put("/me/profile", requireAuth(["patient"]), async (req, res) => {
  try {
    const name = String(req.body.full_name || "").trim();

    if (!name || name.length > 120) {
      return bad(res, "Name is required");
    }

    const age = req.body.age === "" || req.body.age == null
      ? null
      : Number(req.body.age);

    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
      return bad(res, "Age must be between 0 and 120");
    }

    const blood = req.body.blood_group && req.body.blood_group !== "-"
      ? String(req.body.blood_group)
      : null;

    if (blood && !["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].includes(blood)) {
      return bad(res, "Invalid blood group");
    }

    await pool.query(
      "UPDATE app_users SET full_name = ? WHERE user_id = ?",
      [name, req.user.uid]
    );

    await pool.query(
      "UPDATE patient_profiles SET full_name = ? WHERE user_id = ?",
      [name, req.user.uid]
    );

    await pool.query(
      `INSERT INTO user_health_profiles (user_id, age, phone, blood_group, allergies, chronic_conditions)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE age = VALUES(age), phone = VALUES(phone), blood_group = VALUES(blood_group),
         allergies = VALUES(allergies), chronic_conditions = VALUES(chronic_conditions)`,
      [
        req.user.uid,
        age,
        String(req.body.phone || "").slice(0, 30) || null,
        blood,
        String(req.body.allergies || "").slice(0, 255) || null,
        String(req.body.chronic_conditions || "").slice(0, 255) || null
      ]
    );

    res.json({ success: true });
  } catch (error) {
    fail(res, error, "Failed to save profile");
  }
});

router.post("/emergency", requireAuth(["patient"]), async (req, res) => {
  try {
    const hospitalId = positiveInt(req.body.hospital_id);
    const severity = req.body.severity;
    const need = req.body.need || "None";
    const reason = String(req.body.reason || "Emergency").trim().slice(0, 100) || "Emergency";

    if (!hospitalId) return bad(res, "hospital_id is required");
    if (!PRIORITY[severity]) return bad(res, "Severity must be Critical, High, Medium or Low");
    if (!NEED_REQUIREMENTS[need]) return bad(res, "Invalid resource need");

    const [hospitals] = await pool.query(
      "SELECT hospital_name FROM hospitals WHERE hospital_id = ?",
      [hospitalId]
    );

    if (!hospitals.length) return bad(res, "Hospital not found", 404);

    const [open] = await pool.query(
      `SELECT ec.case_id FROM emergency_cases ec
       JOIN patient_profiles pp ON pp.patient_id = ec.patient_id
       WHERE pp.user_id = ? AND ec.process_state NOT IN ('Completed','Cancelled') LIMIT 1`,
      [req.user.uid]
    );

    if (open.length) {
      return bad(
        res,
        "You already have an active emergency case. Cancel it or wait for it to finish.",
        409
      );
    }

    const patientId = await patientForUser(pool, req.user.uid, hospitalId);

    const created = await createEmergencyCase({
      hospitalId,
      patientId,
      caseType: reason,
      triageLevel: severity,
      need
    });

    res.status(201).json({
      success: true,
      data: { ...created, hospital_name: hospitals[0].hospital_name }
    });
  } catch (error) {
    fail(res, error, "Failed to register emergency");
  }
});

router.post("/appointments", requireAuth(["patient"]), async (req, res) => {
  try {
    const hospitalId = positiveInt(req.body.hospital_id);
    const doctorId = positiveInt(req.body.doctor_id);
    const date = String(req.body.date || "");
    const time = String(req.body.time || "");
    const reason = String(req.body.reason || "").trim().slice(0, 500);

    if (
      !hospitalId ||
      !doctorId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !/^\d{2}:\d{2}$/.test(time)
    ) {
      return bad(res, "hospital_id, doctor_id, date (YYYY-MM-DD) and time (HH:MM) are required");
    }

    const when = new Date(`${date}T${time}:00`);

    if (Number.isNaN(when.getTime())) {
      return bad(res, "Invalid date or time");
    }

    if (when <= new Date()) {
      return bad(res, "Appointment must be in the future");
    }

    const [doctors] = await pool.query(
      "SELECT staff_id FROM medical_staff WHERE staff_id = ? AND hospital_id = ? AND role = 'Doctor'",
      [doctorId, hospitalId]
    );

    if (!doctors.length) {
      return bad(res, "That doctor does not work at the selected hospital", 404);
    }

    const [clash] = await pool.query(
      `SELECT appointment_id FROM appointments
       WHERE doctor_id = ? AND appointment_date = ? AND appointment_status NOT IN ('Cancelled','Completed')`,
      [doctorId, when]
    );

    if (clash.length) {
      return bad(res, "That time slot is already booked. Please pick another.", 409);
    }

    const patientId = await patientForUser(pool, req.user.uid, hospitalId);

    const [result] = await pool.query(
      `INSERT INTO appointments (patient_id, hospital_id, doctor_id, appointment_date, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [patientId, hospitalId, doctorId, when, reason || null]
    );

    res.status(201).json({
      success: true,
      data: { appointment_id: result.insertId }
    });
  } catch (error) {
    fail(res, error, "Failed to book appointment");
  }
});

// Patient cancels their own waiting case / upcoming appointment.
router.post("/records/:kind/:id/cancel", requireAuth(["patient"]), async (req, res) => {
  try {
    const id = positiveInt(req.params.id);
    if (!id) return bad(res, "Invalid ID");

    if (req.params.kind === "case") {
      const [rows] = await pool.query(
        `SELECT ec.process_state FROM emergency_cases ec
         JOIN patient_profiles pp ON pp.patient_id = ec.patient_id
         WHERE ec.case_id = ? AND pp.user_id = ?`,
        [id, req.user.uid]
      );

      if (!rows.length) return bad(res, "Case not found", 404);

      if (!["NEW", "Ready", "Waiting"].includes(rows[0].process_state)) {
        return bad(res, "Only cases that have not started can be cancelled", 409);
      }

      await completeCase(id, "Cancelled");

    } else if (req.params.kind === "appt") {
      const [rows] = await pool.query(
        `SELECT a.appointment_status FROM appointments a
         JOIN patient_profiles pp ON pp.patient_id = a.patient_id
         WHERE a.appointment_id = ? AND pp.user_id = ?`,
        [id, req.user.uid]
      );

      if (!rows.length) return bad(res, "Appointment not found", 404);

      if (!["Booked", "Confirmed"].includes(rows[0].appointment_status)) {
        return bad(res, "This appointment can no longer be cancelled", 409);
      }

      await pool.query(
        "UPDATE appointments SET appointment_status = 'Cancelled' WHERE appointment_id = ?",
        [id]
      );

    } else {
      return bad(res, "Unknown record type");
    }

    res.json({ success: true });
  } catch (error) {
    fail(res, error, "Failed to cancel");
  }
});

// ---------------------------------------------------------------- staff / doctor actions

// Change the status of a case or appointment.
router.put("/records/:kind/:id/status", requireAuth(STAFF_ROLES), async (req, res) => {
  try {
    const id = positiveInt(req.params.id);
    const status = req.body.status;

    if (!id) return bad(res, "Invalid ID");

    if (req.params.kind === "case") {
      if (!CASE_STATES.includes(status)) {
        return bad(res, `Status must be one of: ${CASE_STATES.join(", ")}`);
      }

      const [rows] = await pool.query(
        "SELECT hospital_id, process_state FROM emergency_cases WHERE case_id = ?",
        [id]
      );

      if (!rows.length) return bad(res, "Case not found", 404);

      if (!canActOnHospital(req.user, rows[0].hospital_id)) {
        return bad(res, "This case belongs to another hospital", 403);
      }

      if (TERMINAL.includes(rows[0].process_state)) {
        return bad(res, "This case is already completed or cancelled", 409);
      }

      if (TERMINAL.includes(status)) {
        await completeCase(id, status);
        return res.json({
          success: true,
          message: "Case finished and resources released"
        });
      }

      if (status === "Running") {
        const result = await startCase(id);

        return res.json({
          success: true,
          outcome: result.status,
          message: result.status === "RUNNING"
            ? "Case started and resources allocated"
            : `Not enough resources - case is waiting (${result.reason})`
        });
      }

      await pool.query(
        "UPDATE emergency_cases SET process_state = ? WHERE case_id = ?",
        [status, id]
      );

      return res.json({ success: true, message: "Status updated" });
    }

    if (req.params.kind === "appt") {
      if (!APPT_STATUSES.includes(status)) {
        return bad(res, `Status must be one of: ${APPT_STATUSES.join(", ")}`);
      }

      const [rows] = await pool.query(
        "SELECT hospital_id, appointment_status FROM appointments WHERE appointment_id = ?",
        [id]
      );

      if (!rows.length) return bad(res, "Appointment not found", 404);

      if (!canActOnHospital(req.user, rows[0].hospital_id)) {
        return bad(res, "This appointment belongs to another hospital", 403);
      }

      if (req.user.role === "doctor" && req.user.sid) {
        const [own] = await pool.query(
          "SELECT doctor_id FROM appointments WHERE appointment_id = ?",
          [id]
        );

        if (Number(own[0].doctor_id) !== Number(req.user.sid)) {
          return bad(res, "This appointment belongs to another doctor", 403);
        }
      }

      if (TERMINAL.includes(rows[0].appointment_status)) {
        return bad(res, "Completed or cancelled appointments cannot be changed", 409);
      }

      await pool.query(
        "UPDATE appointments SET appointment_status = ? WHERE appointment_id = ?",
        [status, id]
      );

      return res.json({ success: true, message: "Status updated" });
    }

    return bad(res, "Unknown record type");
  } catch (error) {
    fail(res, error, "Failed to update status");
  }
});

// Staff registers a walk-in (emergency case or regular appointment) for a named patient.
router.post("/hospitals/:id/walk-in", requireAuth(["staff", "admin"]), async (req, res) => {
  try {
    const hospitalId = positiveInt(req.params.id);
    if (!hospitalId) return bad(res, "Invalid hospital ID");

    if (!canActOnHospital(req.user, hospitalId)) {
      return bad(res, "You can only register patients at your own hospital", 403);
    }

    const name = String(req.body.name || "").trim();
    if (!name || name.length > 120) return bad(res, "Patient name is required");

    const age = req.body.age === "" || req.body.age == null
      ? null
      : Number(req.body.age);

    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
      return bad(res, "Age must be between 0 and 120");
    }

    const sex = ["Female", "Male", "Other", "Prefer not to say"].includes(req.body.sex)
      ? req.body.sex
      : null;

    const reason = String(req.body.reason || "").trim().slice(0, 100);

    const [hospitals] = await pool.query(
      "SELECT hospital_id FROM hospitals WHERE hospital_id = ?",
      [hospitalId]
    );

    if (!hospitals.length) return bad(res, "Hospital not found", 404);

    if (req.body.type === "Emergency") {
  if (!PRIORITY[req.body.severity]) {
    return bad(res, "Severity must be Critical, High, Medium or Low");
  }

  const resourceRequirements = req.body.resource_requirements || [];

  if (!Array.isArray(resourceRequirements)) {
    return bad(res, "Resource requirements must be an array");
  }

  const allowedResources = [
    "ICU_BED",
    "GENERAL_BED",
    "VENTILATOR",
    "OXYGEN_CYLINDER",
    "OXYGEN_SUPPLY",
    "BLOOD_UNIT"
  ];

  for (const item of resourceRequirements) {
    if (!allowedResources.includes(item.resource_type)) {
      return bad(res, "Invalid resource type");
    }

    const quantity = Number(item.quantity);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return bad(res, "Resource quantities must be positive integers");
    }
  }

  const patientId = await createPatient(pool, {
    hospitalId,
    fullName: name,
    age,
    sex
  });

  const created = await createEmergencyCase({
    hospitalId,
    patientId,
    caseType: reason || "Emergency",
    triageLevel: req.body.severity,
    resourceRequirements
  });

  return res.status(201).json({
    success: true,
    data: created
  });
}

    const doctorId = positiveInt(req.body.doctor_id);

    const [doctors] = doctorId
      ? await pool.query(
          "SELECT staff_id FROM medical_staff WHERE staff_id = ? AND hospital_id = ? AND role = 'Doctor'",
          [doctorId, hospitalId]
        )
      : await pool.query(
          "SELECT staff_id FROM medical_staff WHERE hospital_id = ? AND role = 'Doctor' ORDER BY staff_id LIMIT 1",
          [hospitalId]
        );

    if (!doctors.length) return bad(res, "No doctor is available at this hospital", 404);

    // Next free half-hour slot for this doctor, starting from the next half hour.
    let when = new Date();
    when.setSeconds(0, 0);
    when.setMinutes(when.getMinutes() < 30 ? 30 : 60);

    let slotFound = false;

    for (let i = 0; i < 48; i++) {
      const [clash] = await pool.query(
        `SELECT appointment_id FROM appointments
         WHERE doctor_id = ? AND appointment_date = ?
           AND appointment_status NOT IN ('Cancelled','Completed')`,
        [doctors[0].staff_id, when]
      );

      if (!clash.length) {
        slotFound = true;
        break;
      }

      when = new Date(when.getTime() + 30 * 60000);
    }

    if (!slotFound) {
      return bad(res, "No available appointment slots found", 409);
    }

    const patientId = await createPatient(pool, {
      hospitalId,
      fullName: name,
      age,
      sex
    });

    const [result] = await pool.query(
      `INSERT INTO appointments (patient_id, hospital_id, doctor_id, appointment_date, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [patientId, hospitalId, doctors[0].staff_id, when, reason || null]
    );

    return res.status(201).json({
      success: true,
      data: {
        appointment_id: result.insertId,
        appointment_date: when
      }
    });
  } catch (error) {
    fail(res, error, "Failed to register patient");
  }
});

// Times already taken for one doctor on one day (so the patient can only pick free slots).
router.get("/doctors/:id/booked", requireAuth(["patient"]), async (req, res) => {
  try {
    const id = positiveInt(req.params.id);
    const date = String(req.query.date || "");

    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return bad(res, "doctor id and date (YYYY-MM-DD) are required");
    }

    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(appointment_date, '%H:%i') AS t FROM appointments
       WHERE doctor_id = ? AND DATE(appointment_date) = ?
         AND appointment_status NOT IN ('Cancelled','Completed')`,
      [id, date]
    );

    res.json({ success: true, data: rows.map(r => r.t) });
  } catch (error) {
    fail(res, error, "Failed to load booked slots");
  }
});

// Administrator: every appointment in the system (all hospitals, all doctors).
router.get("/admin/appointments", requireAuth(["admin"]), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.appointment_id, a.appointment_date, a.reason, a.appointment_status, a.created_at,
              a.hospital_id, h.hospital_name, ms.staff_name AS doctor_name,
              COALESCE(pp.full_name, p.patient_code) AS patient_name
       FROM appointments a
       JOIN patients p ON p.patient_id = a.patient_id
       JOIN hospitals h ON h.hospital_id = a.hospital_id
       JOIN medical_staff ms ON ms.staff_id = a.doctor_id
       LEFT JOIN patient_profiles pp ON pp.patient_id = a.patient_id
       ORDER BY a.created_at DESC, a.appointment_id DESC
       LIMIT 500`
    );

    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    fail(res, error, "Failed to load appointments");
  }
});

module.exports = router;