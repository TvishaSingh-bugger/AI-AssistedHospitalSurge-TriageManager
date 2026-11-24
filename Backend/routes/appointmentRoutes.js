const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth, canActOnHospital } = require("../auth");
const { patientForUser } = require("../caseService");

const VALID_STATUSES = ["Booked", "Confirmed", "In Progress", "Completed", "Cancelled"];

const STATUS_TRANSITIONS = {
  Booked: ["Confirmed", "Cancelled"],
  Confirmed: ["In Progress", "Cancelled"],
  "In Progress": ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: []
};

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// POST /api/appointments/book
router.post("/book", requireAuth(["patient"]), async (req, res) => {
  let connection;

  try {
    const hospitalId = validId(req.body.hospital_id);
    const doctorId = validId(req.body.doctor_id);
    const appointmentDate = req.body.appointment_date;
    const reason = req.body.reason || null;

    if (!hospitalId || !doctorId || !appointmentDate) {
      return res.status(400).json({
        success: false,
        message: "hospital_id, doctor_id and appointment_date are required"
      });
    }

    const date = new Date(appointmentDate);

    if (Number.isNaN(date.getTime()) || date <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "Appointment must be scheduled for a valid future date"
      });
    }

    if (reason && (typeof reason !== "string" || reason.length > 500)) {
      return res.status(400).json({
        success: false,
        message: "Reason must not exceed 500 characters"
      });
    }

    const [doctors] = await pool.query(
      `SELECT staff_id
       FROM medical_staff
       WHERE staff_id = ?
         AND hospital_id = ?
         AND role = 'Doctor'`,
      [doctorId, hospitalId]
    );

    if (!doctors.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor or hospital"
      });
    }

    connection = await pool.getConnection();

    const patient = await patientForUser(
      connection,
      req.user.uid,
      hospitalId
    );

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient profile not found"
      });
    }

    const patientId = patient.patient_id;

    const [result] = await connection.query(
      `INSERT INTO appointments
       (patient_id, hospital_id, doctor_id, appointment_date, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [patientId, hospitalId, doctorId, date, reason]
    );

    return res.status(201).json({
      success: true,
      message: "Appointment booked successfully",
      data: {
        appointment_id: result.insertId,
        patient_id: patientId,
        hospital_id: hospitalId,
        doctor_id: doctorId,
        appointment_date: date,
        appointment_status: "Booked"
      }
    });
  } catch (error) {
    console.error("Appointment booking error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to book appointment"
    });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/appointments/patient/:patient_id
router.get("/patient/:patient_id", requireAuth(), async (req, res) => {
  let connection;

  try {
    const patientId = validId(req.params.patient_id);

    if (!patientId) {
      return res.status(400).json({
        success: false,
        message: "Invalid patient ID"
      });
    }

    if (req.user.role === "patient") {
      connection = await pool.getConnection();

      const patient = await patientForUser(
        connection,
        req.user.uid,
        null
      );

      if (!patient || Number(patient.patient_id) !== patientId) {
        return res.status(403).json({
          success: false,
          message: "Access denied"
        });
      }
    } else if (!["staff", "doctor", "admin"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const [appointments] = await pool.query(
      `SELECT a.*, h.hospital_name, ms.staff_name AS doctor_name
       FROM appointments a
       JOIN hospitals h ON h.hospital_id = a.hospital_id
       JOIN medical_staff ms ON ms.staff_id = a.doctor_id
       WHERE a.patient_id = ?
       ORDER BY a.appointment_date DESC`,
      [patientId]
    );

    return res.json({
      success: true,
      count: appointments.length,
      data: appointments
    });
  } catch (error) {
    console.error("Patient appointments error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch appointments"
    });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/appointments/doctor/:doctor_id
router.get("/doctor/:doctor_id", requireAuth(), async (req, res) => {
  try {
    const doctorId = validId(req.params.doctor_id);

    if (!doctorId) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor ID"
      });
    }

    if (!["doctor", "staff", "admin"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    if (
      req.user.role === "doctor" &&
      Number(req.user.sid) !== doctorId
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const [appointments] = await pool.query(
      `SELECT a.*, p.patient_code, p.age, p.sex, h.hospital_name
       FROM appointments a
       JOIN patients p ON p.patient_id = a.patient_id
       JOIN hospitals h ON h.hospital_id = a.hospital_id
       WHERE a.doctor_id = ?
       ORDER BY a.appointment_date ASC`,
      [doctorId]
    );

    return res.json({
      success: true,
      count: appointments.length,
      data: appointments
    });
  } catch (error) {
    console.error("Doctor appointments error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch appointments"
    });
  }
});

// PUT /api/appointments/:appointment_id/status
router.put("/:appointment_id/status", requireAuth(), async (req, res) => {
  try {
    const appointmentId = validId(req.params.appointment_id);
    const status = req.body.appointment_status;

    if (!appointmentId || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment ID or status"
      });
    }

    if (!["doctor", "staff", "admin"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const [rows] = await pool.query(
      `SELECT appointment_id, appointment_status, doctor_id, hospital_id
       FROM appointments
       WHERE appointment_id = ?`,
      [appointmentId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found"
      });
    }

    const appointment = rows[0];

    if (
      req.user.role === "doctor" &&
      Number(req.user.sid) !== Number(appointment.doctor_id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    if (req.user.role === "staff" || req.user.role === "admin") {
      if (!canActOnHospital(req.user, appointment.hospital_id)) {
        return res.status(403).json({
          success: false,
          message: "Access denied for this hospital"
        });
      }
    }

    const currentStatus = appointment.appointment_status;
    const allowedTransitions = STATUS_TRANSITIONS[currentStatus] || [];

    if (!allowedTransitions.includes(status)) {
      return res.status(409).json({
        success: false,
        message: `Cannot change appointment from ${currentStatus} to ${status}`
      });
    }

    await pool.query(
      `UPDATE appointments
       SET appointment_status = ?
       WHERE appointment_id = ?`,
      [status, appointmentId]
    );

    return res.json({
      success: true,
      message: "Appointment status updated",
      data: {
        appointment_id: appointmentId,
        appointment_status: status
      }
    });
  } catch (error) {
    console.error("Appointment status error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to update appointment status"
    });
  }
});

module.exports = router;