// Creates the demo login accounts (idempotent - existing emails are left alone).
// Every demo account uses the password  Demo@123
const pool = require("../db");
const { hashPassword } = require("../auth");

const DEMO_PASSWORD = "Demo@123";

// staffCode links the login to a medical_staff row of the supplied seed data.
const DEMO_USERS = [
  { name: "Admin", email: "admin@mednexus.com", role: "admin" },
  { name: "Dr. Arjun Mehta", email: "arjun@mednexus.com", role: "doctor", hospital: 1, staffCode: "D-DOC-01", staffRole: "Doctor" },
  { name: "Dr. Neha Gupta", email: "neha@mednexus.com", role: "doctor", hospital: 2, staffCode: "H-DOC-01", staffRole: "Doctor" },
  { name: "Rashi Srivastava", email: "rashi@mednexus.com", role: "staff", hospital: 1, staffCode: "D-NUR-01", staffRole: "Nurse" },
  { name: "Vikas Rana", email: "vikas@mednexus.com", role: "staff", hospital: 2, staffCode: "H-NUR-01", staffRole: "Nurse" },
  { name: "Simran Preet Kaur", email: "simran@mail.com", role: "patient" }
];

async function findStaffId(user) {
  const [byCode] = await pool.query(
    "SELECT staff_id FROM medical_staff WHERE hospital_id = ? AND staff_code = ?",
    [user.hospital, user.staffCode]
  );
  if (byCode.length) return byCode[0].staff_id;
  const [any] = await pool.query(
    "SELECT staff_id FROM medical_staff WHERE hospital_id = ? AND role = ? ORDER BY staff_id LIMIT 1",
    [user.hospital, user.staffRole]
  );
  return any.length ? any[0].staff_id : null;
}

async function seed() {
  let created = 0;
  for (const user of DEMO_USERS) {
    const [exists] = await pool.query("SELECT user_id FROM app_users WHERE email = ?", [user.email]);
    if (exists.length) continue;

    const staffId = user.hospital ? await findStaffId(user) : null;
    const [result] = await pool.query(
      `INSERT INTO app_users (full_name, email, password_hash, role, hospital_id, staff_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user.name, user.email, hashPassword(DEMO_PASSWORD), user.role, user.hospital || null, staffId]
    );
    if (user.role === "patient") {
      await pool.query("INSERT INTO user_health_profiles (user_id) VALUES (?)", [result.insertId]);
    }
    created++;
  }
  console.log(`-> demo accounts: ${created} created, ${DEMO_USERS.length - created} already existed (password ${DEMO_PASSWORD})`);
}

module.exports = { seed, DEMO_PASSWORD };

if (require.main === module) {
  seed().then(() => process.exit(0)).catch(error => {
    console.error("Seeding failed:", error.message);
    process.exit(1);
  });
}
