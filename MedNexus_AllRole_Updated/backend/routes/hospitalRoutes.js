
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth } = require("../auth");

// GET /api/hospitals
// Public hospital list for patient registration
router.get("/", async (req, res) => {
  try {
    const [hospitals] = await pool.query(
      `SELECT hospital_id, hospital_code, hospital_name,
              district, state_name, hospital_type, total_beds
       FROM hospitals
       ORDER BY hospital_name ASC`
    );

    return res.json({
      success: true,
      count: hospitals.length,
      data: hospitals
    });
  } catch (error) {
    console.error("Hospital list error:", error);

    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET /api/hospitals/admin/summary
router.get("/admin/summary", requireAuth(["admin"]), async (req, res) => {
  try {
    const [[hospitalStats]] = await pool.query(
      `SELECT COUNT(*) AS total_hospitals,
              COALESCE(SUM(total_beds), 0) AS total_beds
       FROM hospitals`
    );

    const [[patientStats]] = await pool.query(
      `SELECT COUNT(*) AS total_patients
       FROM patients
       WHERE is_synthetic = FALSE`
    );

    const [[caseStats]] = await pool.query(
      `SELECT
          COUNT(*) AS total_cases,
          SUM(process_state IN ('NEW', 'Ready')) AS pending_cases,
          SUM(process_state = 'Running') AS running_cases,
          SUM(process_state = 'Waiting') AS waiting_cases,
          SUM(process_state = 'Completed') AS completed_cases
       FROM emergency_cases
       WHERE patient_id IN (
         SELECT patient_id FROM patients WHERE is_synthetic = FALSE
       )`
    );

    const [[resourceStats]] = await pool.query(
      `SELECT COUNT(*) AS resource_records,
              COALESCE(SUM(total_quantity), 0) AS total_resource_quantity,
              COALESCE(SUM(available_quantity), 0) AS available_resource_quantity
       FROM resource_inventory`
    );

    return res.json({
      success: true,
      data: {
        hospitals: hospitalStats,
        patients: patientStats,
        emergency_cases: caseStats,
        resources: resourceStats
      }
    });
  } catch (error) {
    console.error("Admin summary error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch administrator summary"
    });
  }
});

// GET /api/hospitals/admin/hospitals/:hospital_id/summary
router.get(
  "/admin/hospitals/:hospital_id/summary",
  requireAuth(["admin"]),
  async (req, res) => {
    try {
      const hospitalId = Number(req.params.hospital_id);

      if (!Number.isSafeInteger(hospitalId) || hospitalId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid hospital ID"
        });
      }

      const [hospitalRows] = await pool.query(
        `SELECT hospital_id, hospital_code, hospital_name,
                district, state_name, hospital_type, total_beds
         FROM hospitals
         WHERE hospital_id = ?`,
        [hospitalId]
      );

      if (!hospitalRows.length) {
        return res.status(404).json({
          success: false,
          message: "Hospital not found"
        });
      }

      const [[patientStats]] = await pool.query(
        `SELECT COUNT(*) AS total_patients
         FROM patients
         WHERE hospital_id = ? AND is_synthetic = FALSE`,
        [hospitalId]
      );

      const [[caseStats]] = await pool.query(
        `SELECT
            COUNT(*) AS total_cases,
            SUM(process_state IN ('NEW', 'Ready')) AS pending_cases,
            SUM(process_state = 'Running') AS running_cases,
            SUM(process_state = 'Waiting') AS waiting_cases,
            SUM(process_state = 'Completed') AS completed_cases
         FROM emergency_cases
         WHERE hospital_id = ?
           AND patient_id IN (
             SELECT patient_id FROM patients WHERE is_synthetic = FALSE
           )`,
        [hospitalId]
      );

      const [resources] = await pool.query(
        `SELECT resource_id, resource_type, blood_group,
                total_quantity, available_quantity, unit, updated_at
         FROM resource_inventory
         WHERE hospital_id = ?
         ORDER BY resource_type ASC`,
        [hospitalId]
      );

      return res.json({
        success: true,
        hospital: hospitalRows[0],
        patients: patientStats,
        emergency_cases: caseStats,
        resources
      });
    } catch (error) {
      console.error("Hospital summary error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch hospital summary"
      });
    }
  }
);

// GET /api/hospitals/admin/resources
router.get("/admin/resources", requireAuth(["admin"]), async (req, res) => {
  try {
    const [resources] = await pool.query(
      `SELECT h.hospital_id, h.hospital_name, h.district,
              ri.resource_id, ri.resource_type, ri.blood_group,
              ri.total_quantity, ri.available_quantity,
              ri.unit, ri.updated_at
       FROM hospitals h
       LEFT JOIN resource_inventory ri
         ON ri.hospital_id = h.hospital_id
       ORDER BY h.hospital_name, ri.resource_type`
    );

    return res.json({
      success: true,
      count: resources.length,
      data: resources
    });
  } catch (error) {
    console.error("Admin resources error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch resource availability"
    });
  }
});

module.exports = router;
