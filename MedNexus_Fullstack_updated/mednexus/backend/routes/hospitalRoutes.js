
const express = require("express");
const router = express.Router();
const pool = require("../db");

// 1. GET: List all hospitals
router.get("/", async (req, res) => {
    try {
        const [hospitals] = await pool.query(
            `SELECT *
             FROM hospitals
             ORDER BY hospital_name ASC`
        );

        return res.json({
            success: true,
            count: hospitals.length,
            data: hospitals
        });
    } catch (error) {
        console.error("Error fetching hospitals:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch hospitals"
        });
    }
});


// 2. GET: City-wide administrator dashboard summary
router.get("/admin/summary", async (req, res) => {
    try {
        const [
            [hospitalStats],
            [patientStats],
            [caseStats],
            [resourceStats]
        ] = await Promise.all([
            pool.query(
                `SELECT
                    COUNT(*) AS total_hospitals,
                    COALESCE(SUM(total_beds), 0) AS total_beds
                 FROM hospitals`
            ),

            pool.query(
                `SELECT
                    COUNT(*) AS total_patients
                 FROM patients`
            ),

            pool.query(
                `SELECT
                    COUNT(*) AS total_cases,
                    COALESCE(SUM(
                        CASE WHEN process_state IN ('NEW', 'Ready')
                             THEN 1 ELSE 0 END
                    ), 0) AS pending_cases,
                    COALESCE(SUM(
                        CASE WHEN process_state = 'Running'
                             THEN 1 ELSE 0 END
                    ), 0) AS running_cases,
                    COALESCE(SUM(
                        CASE WHEN process_state = 'Waiting'
                             THEN 1 ELSE 0 END
                    ), 0) AS waiting_cases,
                    COALESCE(SUM(
                        CASE WHEN process_state = 'Completed'
                             THEN 1 ELSE 0 END
                    ), 0) AS completed_cases
                 FROM emergency_cases`
            ),

            pool.query(
                `SELECT
                    COUNT(*) AS resource_records,
                    COALESCE(SUM(total_quantity), 0)
                        AS total_resource_quantity,
                    COALESCE(SUM(available_quantity), 0)
                        AS available_resource_quantity
                 FROM resource_inventory`
            )
        ]);

        return res.json({
            success: true,
            data: {
                hospitals: hospitalStats[0],
                patients: patientStats[0],
                emergency_cases: caseStats[0],
                resources: resourceStats[0]
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


// 3. GET: Hospital-wise statistics
router.get("/admin/hospitals/:hospital_id/summary", async (req, res) => {
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

        if (hospitalRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Hospital not found"
            });
        }

        const [
            [patientRows],
            [caseRows],
            [resourceRows]
        ] = await Promise.all([
            pool.query(
                `SELECT COUNT(*) AS total_patients
                 FROM patients
                 WHERE hospital_id = ?`,
                [hospitalId]
            ),

            pool.query(
                `SELECT
                    COUNT(*) AS total_cases,
                    COALESCE(SUM(
                        CASE WHEN process_state IN ('NEW', 'Ready')
                             THEN 1 ELSE 0 END
                    ), 0) AS pending_cases,
                    COALESCE(SUM(
                        CASE WHEN process_state = 'Running'
                             THEN 1 ELSE 0 END
                    ), 0) AS running_cases,
                    COALESCE(SUM(
                        CASE WHEN process_state = 'Waiting'
                             THEN 1 ELSE 0 END
                    ), 0) AS waiting_cases,
                    COALESCE(SUM(
                        CASE WHEN process_state = 'Completed'
                             THEN 1 ELSE 0 END
                    ), 0) AS completed_cases
                 FROM emergency_cases
                 WHERE hospital_id = ?`,
                [hospitalId]
            ),

            pool.query(
                `SELECT
                    resource_id,
                    resource_type,
                    blood_group,
                    total_quantity,
                    available_quantity,
                    unit,
                    updated_at
                 FROM resource_inventory
                 WHERE hospital_id = ?
                 ORDER BY resource_type ASC`,
                [hospitalId]
            )
        ]);

        return res.json({
            success: true,
            hospital: hospitalRows[0],
            patients: patientRows[0],
            emergency_cases: caseRows[0],
            resources: resourceRows
        });
    } catch (error) {
        console.error("Hospital summary error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch hospital summary"
        });
    }
});


// 4. GET: Resource availability across all hospitals
router.get("/admin/resources", async (req, res) => {
    try {
        const [resources] = await pool.query(
            `SELECT
                h.hospital_id,
                h.hospital_name,
                h.district,
                ri.resource_id,
                ri.resource_type,
                ri.blood_group,
                ri.total_quantity,
                ri.available_quantity,
                ri.unit,
                ri.updated_at
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
