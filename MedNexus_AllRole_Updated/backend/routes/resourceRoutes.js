const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth, canActOnHospital } = require("../auth");
const { allocateResource, releaseResource } = require("../resourceManager");

const STAFF_SIDE = ["staff", "doctor", "admin"];

// GET /api/resources
router.get("/", requireAuth(STAFF_SIDE), async (req, res) => {
  try {
    let query = `
      SELECT
        ri.resource_id,
        ri.hospital_id,
        h.hospital_name,
        ri.resource_type,
        ri.blood_group,
        ri.total_quantity,
        ri.available_quantity,
        ri.unit,
        ri.updated_at
      FROM resource_inventory ri
      JOIN hospitals h ON h.hospital_id = ri.hospital_id
    `;

    const params = [];

    if (req.user.role !== "admin") {
      query += " WHERE ri.hospital_id = ?";
      params.push(req.user.hid);
    }

    query += " ORDER BY h.hospital_name, ri.resource_type, ri.blood_group";

    const [rows] = await pool.query(query, params);

    return res.json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error("Resource fetch error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch resources"
    });
  }
});

// GET /api/resources/hospital/:hospital_id
router.get("/hospital/:hospital_id", requireAuth(STAFF_SIDE), async (req, res) => {
  try {
    const hospitalId = Number(req.params.hospital_id);

    if (!Number.isSafeInteger(hospitalId) || hospitalId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid hospital ID"
      });
    }

    if (!(await canActOnHospital(req, hospitalId))) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this hospital"
      });
    }

    const [rows] = await pool.query(
      `SELECT
          resource_id,
          hospital_id,
          resource_type,
          blood_group,
          total_quantity,
          available_quantity,
          unit,
          updated_at
       FROM resource_inventory
       WHERE hospital_id = ?
       ORDER BY resource_type, blood_group`,
      [hospitalId]
    );

    return res.json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error("Hospital resource fetch error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch hospital resources"
    });
  }
});
// POST /api/resources/allocate
// Manually allocate a resource to an emergency case
router.post("/allocate", requireAuth(STAFF_SIDE), async (req, res) => {
  try {
    const caseId = Number(req.body.case_id);
    const quantity = Number(req.body.quantity || 1);
    const resourceType = req.body.resource_type;
    const bloodGroup = req.body.blood_group || null;

    if (!Number.isInteger(caseId) || caseId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid case ID"
      });
    }

    // Find the hospital associated with this emergency case
    const [cases] = await pool.query(
      `SELECT case_id, hospital_id
       FROM emergency_cases
       WHERE case_id = ?`,
      [caseId]
    );

    if (!cases.length) {
      return res.status(404).json({
        success: false,
        message: "Emergency case not found"
      });
    }

    const hospitalId = cases[0].hospital_id;

    // Check hospital permissions
    if (!canActOnHospital(req.user, hospitalId)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this hospital"
      });
    }

    const result = await allocateResource({
      caseId,
      resourceType,
      quantity,
      bloodGroup
    });

    return res.status(201).json({
      success: true,
      message: "Resource allocated successfully",
      data: result
    });

  } catch (error) {
    console.error("Resource allocation error:", error.message);

    return res.status(400).json({
      success: false,
      message: error.message || "Resource allocation failed"
    });
  }
});


// POST /api/resources/release
// Release an allocated resource
router.post("/release", requireAuth(STAFF_SIDE), async (req, res) => {
  try {
    const allocationId = Number(req.body.allocation_id);

    if (!Number.isInteger(allocationId) || allocationId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid allocation ID"
      });
    }

    // Find the hospital associated with this allocation
    const [rows] = await pool.query(
      `SELECT ri.hospital_id
       FROM resource_allocations ra
       JOIN resource_inventory ri
         ON ri.resource_id = ra.resource_id
       WHERE ra.allocation_id = ?`,
      [allocationId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Allocation not found"
      });
    }

    if (!canActOnHospital(req.user, rows[0].hospital_id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this hospital"
      });
    }

    const result = await releaseResource(allocationId);

    return res.json({
      success: true,
      message: "Resource released successfully",
      data: result
    });

  } catch (error) {
    console.error("Resource release error:", error.message);

    return res.status(400).json({
      success: false,
      message: error.message || "Resource release failed"
    });
  }
});


// GET /api/resources/case/:case_id/allocations
// Get allocations associated with a specific emergency case
router.get("/case/:case_id/allocations", requireAuth(STAFF_SIDE), async (req, res) => {
  try {
    const caseId = Number(req.params.case_id);

    if (!Number.isInteger(caseId) || caseId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid case ID"
      });
    }

    const [cases] = await pool.query(
      `SELECT hospital_id
       FROM emergency_cases
       WHERE case_id = ?`,
      [caseId]
    );

    if (!cases.length) {
      return res.status(404).json({
        success: false,
        message: "Emergency case not found"
      });
    }

    if (!canActOnHospital(req.user, cases[0].hospital_id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this hospital"
      });
    }

    const [rows] = await pool.query(
      `SELECT
          ra.allocation_id,
          ra.case_id,
          ra.resource_id,
          ri.resource_type,
          ri.blood_group,
          ra.quantity,
          ra.allocation_status,
          ra.allocated_at,
          ra.released_at
       FROM resource_allocations ra
       JOIN resource_inventory ri
         ON ri.resource_id = ra.resource_id
       WHERE ra.case_id = ?
       ORDER BY ra.allocation_id DESC`,
      [caseId]
    );

    return res.json({
      success: true,
      count: rows.length,
      data: rows
    });

  } catch (error) {
    console.error("Case allocation fetch error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch case allocations"
    });
  }
});
// PUT /api/resources/:resource_id
// Admin only: update inventory quantities
router.put("/:resource_id", requireAuth(["admin"]), async (req, res) => {
  let conn;

  try {
    const resourceId = Number(req.params.resource_id);
    const total = Number(req.body.total_quantity);
    const available = Number(req.body.available_quantity);

    if (!Number.isSafeInteger(resourceId) || resourceId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid resource ID"
      });
    }

    if (
      !Number.isInteger(total) ||
      !Number.isInteger(available) ||
      total < 0 ||
      available < 0 ||
      available > total
    ) {
      return res.status(400).json({
        success: false,
        message: "Quantities must be non-negative integers and available quantity cannot exceed total quantity"
      });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [existing] = await conn.query(
      `SELECT resource_id
       FROM resource_inventory
       WHERE resource_id = ?
       FOR UPDATE`,
      [resourceId]
    );

    if (!existing.length) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message: "Resource record not found"
      });
    }

    await conn.query(
      `UPDATE resource_inventory
       SET total_quantity = ?, available_quantity = ?
       WHERE resource_id = ?`,
      [total, available, resourceId]
    );

    const [updated] = await conn.query(
      `SELECT resource_id, hospital_id, resource_type, blood_group,
              total_quantity, available_quantity, unit, updated_at
       FROM resource_inventory
       WHERE resource_id = ?`,
      [resourceId]
    );

    await conn.commit();

    return res.json({
      success: true,
      message: "Resource inventory updated",
      data: updated[0]
    });
  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }

    console.error("Resource update error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to update resource inventory"
    });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;