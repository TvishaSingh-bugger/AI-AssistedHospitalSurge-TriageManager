const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth, canActOnHospital } = require("../auth");

const STAFF_SIDE = ["staff", "doctor", "admin"];

// GET /api/patients/:patient_id/cases
router.get("/:patient_id/cases", requireAuth(STAFF_SIDE), async (req, res) => {
  try {
    const patientId = Number(req.params.patient_id);

    if (!Number.isSafeInteger(patientId) || patientId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid patient ID"
      });
    }

    const [patients] = await pool.query(
      `SELECT
          p.patient_id,
          p.patient_code,
          p.hospital_id,
          p.age,
          p.sex,
          p.registered_at,
          pp.full_name
       FROM patients p
       LEFT JOIN patient_profiles pp
         ON pp.patient_id = p.patient_id
       WHERE p.patient_id = ?`,
      [patientId]
    );

    if (!patients.length) {
      return res.status(404).json({
        success: false,
        message: "Patient not found"
      });
    }

    const patient = patients[0];

    if (!(await canActOnHospital(req, patient.hospital_id))) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this patient"
      });
    }

    const [cases] = await pool.query(
      `SELECT
          case_id,
          case_code,
          case_type,
          triage_level,
          arrival_time,
          process_state
       FROM emergency_cases
       WHERE patient_id = ?
       ORDER BY arrival_time DESC`,
      [patientId]
    );

    return res.json({
      success: true,
      patient,
      count: cases.length,
      data: cases
    });
  } catch (error) {
    console.error("Patient cases error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch patient cases"
    });
  }
});

module.exports = router;