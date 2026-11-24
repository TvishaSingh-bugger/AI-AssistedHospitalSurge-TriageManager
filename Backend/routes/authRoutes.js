const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const pool = require("../db");

const {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth
} = require("../auth");

const SEXES = ["Female", "Male", "Other", "Prefer not to say"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(row) {
  return {
    user_id: row.user_id,
    name: row.full_name,
    email: row.email,
    role: row.role,
    hospital_id: row.hospital_id,
    staff_id: row.staff_id,
    is_guest: Boolean(row.is_guest)
  };
}

// ==========================================
// POST /api/auth/register
// Patient registration
// Registration requires a hospital so the linked clinical patient row satisfies the schema.
// ==========================================

router.post("/register", async (req, res) => {
  const name = String(req.body.full_name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const age =
    req.body.age === undefined ||
    req.body.age === "" ||
    req.body.age === null
      ? null
      : Number(req.body.age);

  const sex = req.body.sex || null;
  const phone = req.body.phone || null;
  const hospitalId = Number(req.body.hospital_id);

  if (!name || name.length > 120) {
    return res.status(400).json({
      success: false,
      message: "Name is required (maximum 120 characters)"
    });
  }

  if (!Number.isSafeInteger(hospitalId) || hospitalId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Please select a valid hospital"
    });
  }

  if (!EMAIL_RE.test(email) || email.length > 190) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid email address"
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters"
    });
  }

  if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
    return res.status(400).json({
      success: false,
      message: "Age must be between 0 and 120"
    });
  }

  if (sex && !SEXES.includes(sex)) {
    return res.status(400).json({
      success: false,
      message: "Invalid sex value"
    });
  }

  if (phone && String(phone).length > 30) {
    return res.status(400).json({
      success: false,
      message: "Phone number is too long"
    });
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Check duplicate email
    const [existingUsers] = await conn.query(
      "SELECT user_id FROM app_users WHERE email = ?",
      [email]
    );

    if (existingUsers.length) {
      await conn.rollback();

      return res.status(409).json({
        success: false,
        message: "This email is already registered"
      });
    }

    // Validate hospital selection against the database.
    const [hospitalRows] = await conn.query(
      "SELECT hospital_id FROM hospitals WHERE hospital_id = ?",
      [hospitalId]
    );
    if (!hospitalRows.length) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: "Selected hospital does not exist"
      });
    }

    // Keep account credentials in app_users, separate from the clinical patient record.
    const [userResult] = await conn.query(
      `INSERT INTO app_users
       (full_name, email, password_hash, role, hospital_id, is_guest)
       VALUES (?, ?, ?, 'patient', ?, FALSE)`,
      [name, email, hashPassword(password), hospitalId]
    );

    const userId = userResult.insertId;

    // Generate patient code
    const patientCode =
      "PT-" + crypto.randomBytes(8).toString("hex").toUpperCase();

    // Clinical patient record must belong to the selected hospital (patients.hospital_id is NOT NULL).
    const [patientResult] = await conn.query(
      `INSERT INTO patients
       (hospital_id, patient_code, age, sex, registered_at, is_synthetic)
       VALUES (?, ?, ?, ?, NOW(), FALSE)`,
      [hospitalId, patientCode, age, sex]
    );

    const patientId = patientResult.insertId;

    // Link patient and account
    await conn.query(
      `INSERT INTO patient_profiles
       (patient_id, user_id, full_name)
       VALUES (?, ?, ?)`,
      [patientId, userId, name]
    );

    // Save patient profile information
    await conn.query(
      `INSERT INTO user_health_profiles
       (user_id, age, sex, phone)
       VALUES (?, ?, ?, ?)`,
      [userId, age, sex, phone]
    );

    // Fetch user
    const [userRows] = await conn.query(
      "SELECT * FROM app_users WHERE user_id = ?",
      [userId]
    );

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: "Patient registered successfully",
      token: signToken(userRows[0]),
      user: publicUser(userRows[0]),
      patient: {
        patient_id: patientId,
        patient_code: patientCode,
        hospital_id: hospitalId
      }
    });

  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Email or patient record already exists"
      });
    }

    console.error("Registration error:", error);

    return res.status(500).json({
      success: false,
      message: "Patient registration failed"
    });

  } finally {
    if (conn) conn.release();
  }
});

// ==========================================
// POST /api/auth/register-role
// Self-registration for staff and doctors
// ==========================================
router.post("/register-role", async (req, res) => {
  const name = String(req.body.full_name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const hospitalId = Number(req.body.hospital_id);
  const requestedRole = String(req.body.role || "");
  const designation = requestedRole === "doctor" ? "Doctor" : String(req.body.designation || "Nurse");
  const staffRoles = ["Nurse", "Technician", "Paramedic", "Other"];

  if (! ["staff", "doctor"].includes(requestedRole)) {
    return res.status(400).json({ success: false, message: "Only staff or doctor registration is supported here" });
  }
  if (!name || name.length > 100) return res.status(400).json({ success: false, message: "Name is required (maximum 100 characters)" });
  if (!EMAIL_RE.test(email) || email.length > 190) return res.status(400).json({ success: false, message: "Enter a valid email address" });
  if (password.length < 8) return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
  if (!Number.isSafeInteger(hospitalId) || hospitalId <= 0) return res.status(400).json({ success: false, message: "Please select a valid hospital" });
  if (requestedRole === "staff" && !staffRoles.includes(designation)) return res.status(400).json({ success: false, message: "Invalid staff designation" });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [dupes] = await conn.query("SELECT user_id FROM app_users WHERE email = ?", [email]);
    if (dupes.length) { await conn.rollback(); return res.status(409).json({ success: false, message: "This email is already registered" }); }
    const [hospitals] = await conn.query("SELECT hospital_id FROM hospitals WHERE hospital_id = ?", [hospitalId]);
    if (!hospitals.length) { await conn.rollback(); return res.status(400).json({ success: false, message: "Selected hospital does not exist" }); }

    const staffCode = `${requestedRole.toUpperCase()}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    const staffName = name.slice(0, 100);
    const [staffResult] = await conn.query(
      `INSERT INTO medical_staff (hospital_id, staff_code, staff_name, role, available_count)
       VALUES (?, ?, ?, ?, 1)`, [hospitalId, staffCode, staffName, designation]
    );
    const staffId = staffResult.insertId;
    const [userResult] = await conn.query(
      `INSERT INTO app_users (full_name, email, password_hash, role, hospital_id, staff_id, is_guest)
       VALUES (?, ?, ?, ?, ?, ?, FALSE)`,
      [name, email, hashPassword(password), requestedRole, hospitalId, staffId]
    );
    const [rows] = await conn.query("SELECT * FROM app_users WHERE user_id = ?", [userResult.insertId]);
    await conn.commit();
    return res.status(201).json({ success: true, message: `${requestedRole === "doctor" ? "Doctor" : "Staff"} registered successfully`, token: signToken(rows[0]), user: publicUser(rows[0]) });
  } catch (error) {
    if (conn) { try { await conn.rollback(); } catch {} }
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ success: false, message: "This email or staff code is already registered" });
    console.error("Role registration error:", error);
    return res.status(500).json({ success: false, message: "Staff/doctor registration failed" });
  } finally { if (conn) conn.release(); }
});

// ==========================================
// POST /api/auth/login
// ==========================================

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body.password || "");
    const requestedRole = req.body.role;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const [rows] = await pool.query(
      "SELECT * FROM app_users WHERE email = ?",
      [email]
    );

    const user = rows[0];

    if (
      !user ||
      user.is_guest ||
      !verifyPassword(password, user.password_hash)
    ) {
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password"
      });
    }

    if (requestedRole && requestedRole !== user.role) {
      return res.status(403).json({
        success: false,
        message: `This is a ${user.role} account`
      });
    }

    return res.json({
      success: true,
      token: signToken(user),
      user: publicUser(user)
    });

  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Login failed"
    });
  }
});

// ==========================================
// POST /api/auth/bootstrap-admin
// First-time administrator setup
// ==========================================

router.post("/bootstrap-admin", async (req, res) => {
  const configuredKey = String(process.env.ADMIN_BOOTSTRAP_KEY || "");
  const bootstrapKey = String(req.body.bootstrap_key || "");

  if (
    !configuredKey ||
    configuredKey.length < 16 ||
    bootstrapKey !== configuredKey
  ) {
    return res.status(403).json({
      success: false,
      message: "Invalid administrator setup key"
    });
  }

  const name = String(req.body.full_name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!name || name.length > 120 || !EMAIL_RE.test(email) || email.length > 190) {
    return res.status(400).json({
      success: false,
      message: "Provide a valid name and email"
    });
  }

  if (password.length < 12) {
    return res.status(400).json({
      success: false,
      message: "Admin password must be at least 12 characters"
    });
  }

  let conn;
  let lockAcquired = false;

  try {
    conn = await pool.getConnection();

    const [[lockRow]] = await conn.query(
      "SELECT GET_LOCK('mednexus_admin_bootstrap', 10) AS locked"
    );

    if (Number(lockRow.locked) !== 1) {
      return res.status(503).json({
        success: false,
        message: "Could not acquire setup lock. Try again."
      });
    }

    lockAcquired = true;

    await conn.beginTransaction();

    const [[adminCount]] = await conn.query(
      "SELECT COUNT(*) AS total FROM app_users WHERE role = 'admin'"
    );

    if (Number(adminCount.total) > 0) {
      await conn.rollback();

      return res.status(409).json({
        success: false,
        message: "Administrator has already been created"
      });
    }

    const [result] = await conn.query(
      `INSERT INTO app_users
       (full_name, email, password_hash, role, is_guest)
       VALUES (?, ?, ?, 'admin', FALSE)`,
      [name, email, hashPassword(password)]
    );

    const [rows] = await conn.query(
      "SELECT * FROM app_users WHERE user_id = ?",
      [result.insertId]
    );

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: "Administrator account created",
      token: signToken(rows[0]),
      user: publicUser(rows[0])
    });

  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "This email is already registered"
      });
    }

    console.error("Admin setup error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Administrator setup failed"
    });

  } finally {
    if (conn) {
      if (lockAcquired) {
        try {
          await conn.query("SELECT RELEASE_LOCK('mednexus_admin_bootstrap')");
        } catch {}
      }

      conn.release();
    }
  }
});

// ==========================================
// GET /api/auth/me
// ==========================================

router.get("/me", requireAuth(), async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM app_users WHERE user_id = ?",
      [req.user.uid]
    );

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        message: "Account no longer exists"
      });
    }

    return res.json({
      success: true,
      user: publicUser(rows[0])
    });

  } catch (error) {
    console.error("Auth me error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to load account"
    });
  }
});


// ==========================================
// POST /api/auth/guest
// Emergency guest login
// ==========================================

router.post("/guest", async (req, res) => {
  try {
    const guestEmail =
      `guest_${crypto.randomBytes(8).toString("hex")}@mednexus.local`;

    const guestName = "Emergency Guest";
    const guestPassword = crypto.randomBytes(32).toString("hex");

    const [result] = await pool.query(
      `INSERT INTO app_users
       (full_name, email, password_hash, role, hospital_id, is_guest)
       VALUES (?, ?, ?, 'patient', NULL, TRUE)`,
      [guestName, guestEmail, hashPassword(guestPassword)]
    );

    const [rows] = await pool.query(
      "SELECT * FROM app_users WHERE user_id = ?",
      [result.insertId]
    );

    const user = rows[0];

    return res.status(201).json({
      success: true,
      message: "Emergency guest login successful",
      token: signToken(user),
      user: publicUser(user)
    });

  } catch (error) {
    console.error("Emergency guest login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Emergency login failed"
    });
  }
});

module.exports = router;