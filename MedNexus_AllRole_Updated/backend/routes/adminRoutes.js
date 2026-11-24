// Administrator-only endpoints: user management, adding/removing hospitals, system overview.
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth, hashPassword } = require("../auth");

router.use(requireAuth(["admin"]));

const ROLES = ["patient", "staff", "doctor", "admin"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOSPITAL_TYPES = ["Government", "Private", "Trust", "Other"];

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });
const fail = (res, error, fallback) => {
  console.error(fallback + ":", error.message);
  return res.status(500).json({ success: false, message: fallback });
};

router.get("/users", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.user_id, u.full_name, u.email, u.role, u.hospital_id, h.hospital_name, u.is_guest, u.created_at
       FROM app_users u LEFT JOIN hospitals h ON h.hospital_id = u.hospital_id
       WHERE u.is_guest = FALSE
       ORDER BY u.user_id DESC LIMIT 500`
    );
    const [[guests]] = await pool.query("SELECT COUNT(*) AS n FROM app_users WHERE is_guest = TRUE");
    res.json({ success: true, data: rows, guest_accounts: Number(guests.n) });
  } catch (error) {
    fail(res, error, "Failed to load users");
  }
});

router.post("/users", async (req, res) => {
  try {
    const name = String(req.body.full_name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const role = req.body.role;
    const hospitalId = req.body.hospital_id ? Number(req.body.hospital_id) : null;

    if (!name || name.length > 120) return bad(res, "Name is required");
    if (!EMAIL_RE.test(email)) return bad(res, "A valid email is required");
    if (password.length < 6) return bad(res, "Password must be at least 6 characters");
    if (!ROLES.includes(role)) return bad(res, "Invalid role");
    if (["staff", "doctor"].includes(role)) {
      if (!Number.isSafeInteger(hospitalId) || hospitalId <= 0) return bad(res, "Staff and doctors need a hospital");
      const [h] = await pool.query("SELECT hospital_id FROM hospitals WHERE hospital_id = ?", [hospitalId]);
      if (!h.length) return bad(res, "Hospital not found", 404);
    }
    const [dup] = await pool.query("SELECT user_id FROM app_users WHERE email = ?", [email]);
    if (dup.length) return bad(res, "This email is already registered", 409);

    let staffId = null;
    if (["staff", "doctor"].includes(role)) {
      const code = `USR-${Date.now().toString(36).toUpperCase()}`;
      const [s] = await pool.query(
        `INSERT INTO medical_staff (hospital_id, staff_code, staff_name, role, available_count)
         VALUES (?, ?, ?, ?, 1)`,
        [hospitalId, code, name, role === "doctor" ? "Doctor" : "Nurse"]
      );
      staffId = s.insertId;
    }

    const [result] = await pool.query(
      `INSERT INTO app_users (full_name, email, password_hash, role, hospital_id, staff_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email, hashPassword(password), role, ["staff", "doctor"].includes(role) ? hospitalId : null, staffId]
    );
    if (role === "patient") {
      await pool.query("INSERT INTO user_health_profiles (user_id) VALUES (?)", [result.insertId]);
    }
    res.status(201).json({ success: true, data: { user_id: result.insertId } });
  } catch (error) {
    fail(res, error, "Failed to create user");
  }
});

router.delete("/users/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return bad(res, "Invalid user ID");
    if (id === req.user.uid) return bad(res, "You cannot delete your own account", 409);
    const [rows] = await pool.query("SELECT user_id FROM app_users WHERE user_id = ?", [id]);
    if (!rows.length) return bad(res, "User not found", 404);

    // Keep the medical history of patient rows; only detach them from the account.
    await pool.query("UPDATE patient_profiles SET user_id = NULL WHERE user_id = ?", [id]);
    await pool.query("DELETE FROM user_health_profiles WHERE user_id = ?", [id]);
    await pool.query("UPDATE prescriptions SET doctor_user_id = NULL WHERE doctor_user_id = ?", [id]);
    await pool.query("DELETE FROM app_users WHERE user_id = ?", [id]);
    res.json({ success: true });
  } catch (error) {
    fail(res, error, "Failed to delete user");
  }
});

router.post("/hospitals", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const name = String(req.body.name || "").trim();
    const district = String(req.body.district || "").trim() || "Unspecified";
    const type = HOSPITAL_TYPES.includes(req.body.type) ? req.body.type : "Government";
    const beds = req.body.total_beds === "" || req.body.total_beds == null ? 50 : Number(req.body.total_beds);
    if (!name || name.length > 150) return bad(res, "Hospital name is required");
    if (!Number.isSafeInteger(beds) || beds < 1 || beds > 5000) return bad(res, "Total beds must be between 1 and 5000");

    await conn.beginTransaction();
    const [dupe] = await conn.query("SELECT hospital_id FROM hospitals WHERE hospital_name = ?", [name]);
    if (dupe.length) {
      await conn.rollback();
      return bad(res, "A hospital with this name already exists", 409);
    }
    const [result] = await conn.query(
      `INSERT INTO hospitals (hospital_code, hospital_name, district, hospital_type, total_beds)
       VALUES (?, ?, ?, ?, ?)`,
      [`ADM-${Date.now().toString(36).toUpperCase()}`, name, district.slice(0, 100), type, beds]
    );
    const id = result.insertId;
    const defaults = [
      ["ICU_BED", null, Math.max(2, Math.floor(beds * 0.1)), "beds"],
      ["GENERAL_BED", null, Math.max(5, Math.floor(beds * 0.8)), "beds"],
      ["VENTILATOR", null, Math.max(1, Math.floor(beds * 0.05)), "units"],
      ["OXYGEN_CYLINDER", null, Math.max(4, Math.floor(beds * 0.25)), "cylinders"],
      ["BLOOD_UNIT", "O+", Math.max(5, Math.floor(beds * 0.1)), "units"]
    ];
    for (const [type_, bg, qty, unit] of defaults) {
      await conn.query(
        `INSERT INTO resource_inventory (hospital_id, resource_type, blood_group, total_quantity, available_quantity, unit)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, type_, bg, qty, qty, unit]
      );
    }
    await conn.query(
      `INSERT INTO medical_staff (hospital_id, staff_code, staff_name, role, available_count)
       VALUES (?, ?, ?, 'Doctor', 1)`,
      [id, `AUTO-DOC-${id}`, `Duty Doctor ${id}`]
    );
    await conn.commit();
    res.status(201).json({ success: true, data: { hospital_id: id } });
  } catch (error) {
    await conn.rollback();
    fail(res, error, "Failed to add hospital");
  } finally {
    conn.release();
  }
});

// Only hospitals created from the admin screen (code ADM-*) with no activity can be removed.
router.delete("/hospitals/:id", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return bad(res, "Invalid hospital ID");
    const [rows] = await conn.query("SELECT hospital_code FROM hospitals WHERE hospital_id = ?", [id]);
    if (!rows.length) return bad(res, "Hospital not found", 404);
    if (!String(rows[0].hospital_code).startsWith("ADM-")) {
      return bad(res, "Hospitals from the original dataset hold historical records and cannot be removed", 409);
    }
    const [[used]] = await conn.query(
      `SELECT (SELECT COUNT(*) FROM patients WHERE hospital_id = ?) +
              (SELECT COUNT(*) FROM app_users WHERE hospital_id = ?) AS n`,
      [id, id]
    );
    if (Number(used.n) > 0) return bad(res, "This hospital already has patients or users and cannot be removed", 409);

    await conn.beginTransaction();
    await conn.query(
      "DELETE FROM resource_history WHERE resource_id IN (SELECT resource_id FROM resource_inventory WHERE hospital_id = ?)",
      [id]
    );
    await conn.query("DELETE FROM resource_inventory WHERE hospital_id = ?", [id]);
    await conn.query("DELETE FROM medical_staff WHERE hospital_id = ?", [id]);
    await conn.query("DELETE FROM system_events WHERE hospital_id = ?", [id]);
    await conn.query("DELETE FROM hospitals WHERE hospital_id = ?", [id]);
    await conn.commit();
    res.json({ success: true });
  } catch (error) {
    await conn.rollback();
    fail(res, error, "Failed to remove hospital");
  } finally {
    conn.release();
  }
});

// Dashboard numbers: totals, 14-day arrival trend (from emergency_cases) and server uptime.
router.get("/overview", async (req, res) => {
  try {
    const [trend] = await pool.query(
      `SELECT DATE_FORMAT(arrival_time, '%Y-%m-%d') AS day, COUNT(*) AS cases,
              SUM(triage_level = 'Critical') AS critical
       FROM emergency_cases
       WHERE arrival_time >= CURDATE() - INTERVAL 14 DAY AND arrival_time < CURDATE() + INTERVAL 1 DAY
       GROUP BY day ORDER BY day`
    );
    const [[counts]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM hospitals) AS hospitals,
              (SELECT COUNT(*) FROM app_users WHERE is_guest = FALSE) AS users,
              (SELECT COUNT(*) FROM emergency_cases WHERE process_state NOT IN ('Completed','Cancelled')) AS active_cases,
              (SELECT COALESCE(SUM(total_quantity),0) FROM resource_inventory) AS resource_units`
    );
    const [[latest]] = await pool.query("SELECT MAX(arrival_time) AS latest FROM emergency_cases");
    res.json({
      success: true,
      data: {
        ...counts,
        trend: trend.map(t => ({ day: t.day, cases: Number(t.cases), critical: Number(t.critical) })),
        latest_case_time: latest.latest,
        uptime_seconds: Math.round(process.uptime())
      }
    });
  } catch (error) {
    fail(res, error, "Failed to load overview");
  }
});

module.exports = router;
