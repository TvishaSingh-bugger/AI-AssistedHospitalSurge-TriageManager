const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const pool = require("../db");
const { hashPassword, verifyPassword, signToken, requireAuth } = require("../auth");

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

// POST /api/auth/register - patient self-registration
router.post("/register", async (req, res) => {
  try {
    const name = String(req.body.full_name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!name || name.length > 120) {
      return res.status(400).json({ success: false, message: "Name is required (max 120 characters)" });
    }
    if (!EMAIL_RE.test(email) || email.length > 190) {
      return res.status(400).json({ success: false, message: "A valid email is required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }
    if (req.body.sex && !SEXES.includes(req.body.sex)) {
      return res.status(400).json({ success: false, message: "Invalid sex value" });
    }
    const age = req.body.age === undefined || req.body.age === "" || req.body.age === null ? null : Number(req.body.age);
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
      return res.status(400).json({ success: false, message: "Age must be between 0 and 120" });
    }

    const [dup] = await pool.query("SELECT user_id FROM app_users WHERE email = ?", [email]);
    if (dup.length) {
      return res.status(409).json({ success: false, message: "This email is already registered" });
    }

    const [result] = await pool.query(
      "INSERT INTO app_users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'patient')",
      [name, email, hashPassword(password)]
    );
    await pool.query(
      "INSERT INTO user_health_profiles (user_id, age, sex) VALUES (?, ?, ?)",
      [result.insertId, age, req.body.sex || null]
    );

    const [[user]] = await pool.query("SELECT * FROM app_users WHERE user_id = ?", [result.insertId]);
    return res.status(201).json({ success: true, token: signToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("Register error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to register" });
  }
});

// POST /api/auth/login { email, password, role? }
router.post("/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const role = req.body.role;

    const [rows] = await pool.query("SELECT * FROM app_users WHERE email = ?", [email]);
    const user = rows[0];
    if (!user || user.is_guest || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ success: false, message: "Incorrect email or password" });
    }
    if (role && role !== user.role) {
      return res.status(403).json({
        success: false,
        message: `This is a ${user.role} account. Choose the "${user.role}" tab to log in.`
      });
    }
    return res.json({ success: true, token: signToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to log in" });
  }
});

// POST /api/auth/guest - "Emergency Login": a throw-away patient account, no password needed
router.post("/guest", async (req, res) => {
  try {
    const id = crypto.randomBytes(6).toString("hex");
    const [result] = await pool.query(
      `INSERT INTO app_users (full_name, email, password_hash, role, is_guest)
       VALUES ('Emergency Patient', ?, ?, 'patient', TRUE)`,
      [`guest-${id}@guest.local`, hashPassword(crypto.randomBytes(16).toString("hex"))]
    );
    await pool.query("INSERT INTO user_health_profiles (user_id) VALUES (?)", [result.insertId]);
    const [[user]] = await pool.query("SELECT * FROM app_users WHERE user_id = ?", [result.insertId]);
    return res.status(201).json({ success: true, token: signToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("Guest login error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to start emergency session" });
  }
});

// GET /api/auth/me - validate a stored token and refresh the user record
router.get("/me", requireAuth(), async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM app_users WHERE user_id = ?", [req.user.uid]);
    if (!rows.length) return res.status(401).json({ success: false, message: "Account no longer exists" });
    return res.json({ success: true, user: publicUser(rows[0]) });
  } catch (error) {
    console.error("Me error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to load account" });
  }
});

module.exports = router;
