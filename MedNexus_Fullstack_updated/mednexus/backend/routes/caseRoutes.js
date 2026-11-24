const express = require("express");
const router = express.Router();
const pool = require("../db");
const { completeCase, startCase } = require("../dispatcher");
const { createEmergencyCase, PRIORITY } = require("../caseService");
const { canActOnHospital } = require("../auth");

const ALLOWED_STATES = ["Ready", "Running", "Waiting", "Completed", "Cancelled"];
const TERMINAL = ["Completed", "Cancelled"];

function fail(res, error, fallback) {
    if (error.status) {
        return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error(fallback + ":", error.message);
    return res.status(500).json({ success: false, message: fallback });
}

// GET: list emergency cases (filterable + limited; the table holds hundreds of thousands of rows)
router.get("/", async (req, res) => {
    try {
        const where = [];
        const params = [];

        if (req.query.hospital_id) {
            where.push("ec.hospital_id = ?");
            params.push(Number(req.query.hospital_id));
        }
        if (req.query.state) {
            where.push("ec.process_state = ?");
            params.push(String(req.query.state));
        }
        if (req.query.active === "true") {
            where.push("ec.process_state NOT IN ('Completed', 'Cancelled')");
        }

        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 1000);

        const [cases] = await pool.query(
            `SELECT
                ec.case_id, ec.case_code, ec.hospital_id, h.hospital_name,
                ec.patient_id, p.patient_code, p.age, p.sex,
                ec.case_type, ec.triage_level, ec.priority,
                ec.arrival_time, ec.process_state, ec.assigned_staff_id, ec.notes
             FROM emergency_cases ec
             JOIN hospitals h ON ec.hospital_id = h.hospital_id
             JOIN patients p ON ec.patient_id = p.patient_id
             ${where.length ? "WHERE " + where.join(" AND ") : ""}
             ORDER BY ec.priority DESC, ec.arrival_time ASC
             LIMIT ?`,
            [...params, limit]
        );

        res.json({ success: true, count: cases.length, data: cases });
    } catch (error) {
        fail(res, error, "Failed to fetch emergency cases");
    }
});

// POST: Register a new emergency case
router.post("/register", async (req, res) => {
    try {
        const { hospital_id, patient_id, case_type, triage_level } = req.body;

        if (hospital_id == null || patient_id == null || !case_type?.trim() || !triage_level) {
            return res.status(400).json({
                success: false,
                message: "Hospital ID, patient ID, case type and triage level are required"
            });
        }

        const hospitalId = Number(hospital_id);
        const patientId = Number(patient_id);

        if (
            !Number.isSafeInteger(hospitalId) || hospitalId <= 0 ||
            !Number.isSafeInteger(patientId) || patientId <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Hospital ID and patient ID must be positive integers"
            });
        }

        if (!PRIORITY[triage_level]) {
            return res.status(400).json({
                success: false,
                message: "Triage level must be Critical, High, Medium or Low"
            });
        }

        if (case_type.trim().length > 100) {
            return res.status(400).json({
                success: false,
                message: "Case type cannot exceed 100 characters"
            });
        }

        const [hospitals] = await pool.query(
            "SELECT hospital_id FROM hospitals WHERE hospital_id = ?", [hospitalId]
        );
        if (hospitals.length === 0) {
            return res.status(404).json({ success: false, message: "Hospital not found" });
        }

        const [patients] = await pool.query(
            "SELECT patient_id FROM patients WHERE patient_id = ? AND hospital_id = ?",
            [patientId, hospitalId]
        );
        if (patients.length === 0) {
            return res.status(404).json({ success: false, message: "Patient not found at this hospital" });
        }

        // Demo burst time for the scheduler (not a clinical measurement)
        const burstTime = Number(req.body.burst_time) > 0 ? Math.floor(Number(req.body.burst_time)) : 5;

        const created = await createEmergencyCase({
            hospitalId,
            patientId,
            caseType: case_type.trim(),
            triageLevel: triage_level,
            need: req.body.need || "None",
            burstTime
        });

        return res.status(201).json({
            success: true,
            message: "Emergency case registered successfully",
            data: {
                ...created,
                hospital_id: hospitalId,
                patient_id: patientId,
                case_type: case_type.trim(),
                triage_level
            }
        });
    } catch (error) {
        return fail(res, error, "Failed to register emergency case");
    }
});

async function loadCase(caseId) {
    const [cases] = await pool.query(
        `SELECT case_id, case_code, hospital_id, process_state
         FROM emergency_cases WHERE case_id = ?`,
        [caseId]
    );
    return cases[0];
}

// PUT: Update emergency case treatment status
router.put("/:case_id/status", async (req, res) => {
    try {
        const caseId = Number(req.params.case_id);
        const { process_state } = req.body;

        if (!Number.isSafeInteger(caseId) || caseId <= 0) {
            return res.status(400).json({ success: false, message: "Invalid case ID" });
        }
        if (!ALLOWED_STATES.includes(process_state)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status. Use Ready, Running, Waiting, Completed or Cancelled."
            });
        }

        const current = await loadCase(caseId);
        if (!current) {
            return res.status(404).json({ success: false, message: "Emergency case not found" });
        }
        if (!canActOnHospital(req.user, current.hospital_id)) {
            return res.status(403).json({ success: false, message: "This case belongs to another hospital" });
        }
        if (TERMINAL.includes(current.process_state)) {
            return res.status(409).json({
                success: false,
                message: "This case is already completed or cancelled"
            });
        }

        if (TERMINAL.includes(process_state)) {
            const result = await completeCase(caseId, process_state);
            return res.json({
                success: true,
                message: "Case finished and resources released",
                data: result
            });
        }

        if (process_state === "Running") {
            const result = await startCase(caseId);
            return res.json({
                success: true,
                message: result.status === "RUNNING"
                    ? "Case started and resources allocated"
                    : "Not enough resources - case is waiting",
                data: result
            });
        }

        await pool.query(
            "UPDATE emergency_cases SET process_state = ? WHERE case_id = ?",
            [process_state, caseId]
        );

        return res.json({
            success: true,
            message: "Emergency case status updated successfully",
            data: {
                case_id: caseId,
                case_code: current.case_code,
                previous_state: current.process_state,
                process_state
            }
        });
    } catch (error) {
        return fail(res, error, "Failed to update case status");
    }
});

// POST: start a specific case (allocates the resources it needs)
router.post("/:case_id/start", async (req, res) => {
    try {
        const caseId = Number(req.params.case_id);
        if (!Number.isSafeInteger(caseId) || caseId <= 0) {
            return res.status(400).json({ success: false, message: "Invalid case ID" });
        }
        const current = await loadCase(caseId);
        if (!current) {
            return res.status(404).json({ success: false, message: "Emergency case not found" });
        }
        if (!canActOnHospital(req.user, current.hospital_id)) {
            return res.status(403).json({ success: false, message: "This case belongs to another hospital" });
        }
        const result = await startCase(caseId);
        return res.json({ success: true, data: result });
    } catch (error) {
        return fail(res, error, "Failed to start case");
    }
});

module.exports = router;
