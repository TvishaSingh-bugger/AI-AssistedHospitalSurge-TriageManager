const express = require("express");
const router = express.Router();
const pool = require("../db");

const VALID_STATUSES = ["Booked", "Confirmed", "In Progress", "Completed", "Cancelled"];

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// POST /api/appointments/book
router.post("/book", async (req, res) => {
  try {
    const patientId = validId(req.body.patient_id);
    const hospitalId = validId(req.body.hospital_id);
    const doctorId = validId(req.body.doctor_id);
    const { appointment_date, reason } = req.body;

    if (!patientId || !hospitalId || !doctorId || !appointment_date) {
      return res.status(400).json({ success: false, message: "patient_id, hospital_id, doctor_id and appointment_date are required" });
    }

    const date = new Date(appointment_date);
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid appointment_date" });
    }
    if (date <= new Date()) {
      return res.status(400).json({ success: false, message: "Appointment date must be in the future" });
    }
    if (reason != null && (typeof reason !== "string" || reason.length > 500)) {
      return res.status(400).json({ success: false, message: "reason must be a string of at most 500 characters" });
    }

    const [matches] = await pool.query(
      `SELECT p.patient_id
       FROM patients p
       JOIN medical_staff ms ON ms.hospital_id = p.hospital_id
       JOIN hospitals h ON h.hospital_id = p.hospital_id
       WHERE p.patient_id = ? AND h.hospital_id = ?
         AND ms.staff_id = ? AND ms.role = 'Doctor'`,
      [patientId, hospitalId, doctorId]
    );
    if (!matches.length) {
      return res.status(400).json({ success: false, message: "Patient and doctor must belong to the selected hospital, and the selected staff member must be a doctor" });
    }

    const [result] = await pool.query(
      `INSERT INTO appointments
       (patient_id, hospital_id, doctor_id, appointment_date, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [patientId, hospitalId, doctorId, date, reason?.trim() || null]
    );

    return res.status(201).json({
      success: true,
      message: "Appointment booked successfully",
      data: { appointment_id: result.insertId, patient_id: patientId, hospital_id: hospitalId, doctor_id: doctorId, appointment_date: date, appointment_status: "Booked" }
    });
  } catch (error) {
    console.error("Appointment booking error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to book appointment" });
  }
});

// GET /api/appointments/patient/:patient_id
router.get("/patient/:patient_id", async (req, res) => {
  try {
    const patientId = validId(req.params.patient_id);
    if (!patientId) return res.status(400).json({ success: false, message: "Invalid patient ID" });

    const [appointments] = await pool.query(
      `SELECT a.*, h.hospital_name, ms.staff_name AS doctor_name
       FROM appointments a
       JOIN hospitals h ON h.hospital_id = a.hospital_id
       JOIN medical_staff ms ON ms.staff_id = a.doctor_id
       WHERE a.patient_id = ? ORDER BY a.appointment_date DESC`,
      [patientId]
    );
    return res.json({ success: true, count: appointments.length, data: appointments });
  } catch (error) {
    console.error("Patient appointments error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch patient appointments" });
  }
});

// GET /api/appointments/doctor/:doctor_id
router.get("/doctor/:doctor_id", async (req, res) => {
  try {
    const doctorId = validId(req.params.doctor_id);
    if (!doctorId) return res.status(400).json({ success: false, message: "Invalid doctor ID" });

    const [doctors] = await pool.query(
      "SELECT staff_id FROM medical_staff WHERE staff_id = ? AND role = 'Doctor'", [doctorId]
    );
    if (!doctors.length) return res.status(404).json({ success: false, message: "Doctor not found" });

    const [appointments] = await pool.query(
      `SELECT a.*, p.patient_code, p.age, p.sex, h.hospital_name
       FROM appointments a
       JOIN patients p ON p.patient_id = a.patient_id
       JOIN hospitals h ON h.hospital_id = a.hospital_id
       WHERE a.doctor_id = ? ORDER BY a.appointment_date ASC`,
      [doctorId]
    );
    return res.json({ success: true, count: appointments.length, data: appointments });
  } catch (error) {
    console.error("Doctor appointments error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch doctor appointments" });
  }
});

// PUT /api/appointments/:appointment_id/status
router.put("/:appointment_id/status", async (req, res) => {
  try {
    const appointmentId = validId(req.params.appointment_id);
    const { appointment_status: status } = req.body;
    if (!appointmentId) return res.status(400).json({ success: false, message: "Invalid appointment ID" });
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ success: false, message: `Status must be one of: ${VALID_STATUSES.join(", ")}` });

    const [rows] = await pool.query(
      "SELECT appointment_status FROM appointments WHERE appointment_id = ?", [appointmentId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "Appointment not found" });
    if (["Completed", "Cancelled"].includes(rows[0].appointment_status)) {
      return res.status(409).json({ success: false, message: "Completed or cancelled appointments cannot be changed" });
    }

    await pool.query("UPDATE appointments SET appointment_status = ? WHERE appointment_id = ?", [status, appointmentId]);
    return res.json({ success: true, message: "Appointment status updated", data: { appointment_id: appointmentId, appointment_status: status } });
  } catch (error) {
    console.error("Appointment status error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to update appointment status" });
  }
});

module.exports = router;
