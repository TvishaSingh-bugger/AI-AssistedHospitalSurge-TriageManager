const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth } = require("../auth");

// GET: Staff dashboard
router.get("/:staff_id/dashboard", requireAuth(["staff", "admin"]), async (req, res) => {
    try {
        const staffId = Number(req.params.staff_id);

        if (!Number.isSafeInteger(staffId) || staffId <= 0) {
            return res.status(400).json({ success: false, message: "Invalid staff ID" });
        }

        if (req.user.role === "staff" && Number(req.user.sid) !== staffId) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        const [staffMembers] = await pool.query(
            `SELECT staff_id, staff_name, role, hospital_id
             FROM medical_staff
             WHERE staff_id = ?`,
            [staffId]
        );

        if (!staffMembers.length) {
            return res.status(404).json({ success: false, message: "Staff member not found" });
        }

        const staff = staffMembers[0];

        const [cases] = await pool.query(
            `SELECT ec.case_id, ec.case_code, ec.patient_id,
                    ec.case_type, ec.triage_level, ec.priority,
                    ec.arrival_time, ec.process_state,
                    qe.queue_entry_id, qe.queue_type,
                    qe.queue_position, qe.queue_status, qe.entered_at
             FROM emergency_cases ec
             LEFT JOIN queue_entries qe
                ON qe.case_id = ec.case_id
                AND qe.hospital_id = ec.hospital_id
                AND qe.removed_at IS NULL
             WHERE ec.hospital_id = ?
               AND ec.process_state NOT IN ('Completed', 'Cancelled')
             ORDER BY
                CASE ec.triage_level
                    WHEN 'Critical' THEN 1
                    WHEN 'High' THEN 2
                    WHEN 'Medium' THEN 3
                    WHEN 'Low' THEN 4
                    ELSE 5
                END,
                ec.arrival_time ASC`,
            [staff.hospital_id]
        );

        const [resources] = await pool.query(
            `SELECT resource_id, resource_type, blood_group,
                    total_quantity, available_quantity, unit, updated_at
             FROM resource_inventory
             WHERE hospital_id = ?
             ORDER BY resource_type ASC`,
            [staff.hospital_id]
        );

        const summary = {
            total_active_cases: cases.length,
            new_cases: cases.filter(c => c.process_state === "NEW").length,
            ready_cases: cases.filter(c => c.process_state === "Ready").length,
            running_cases: cases.filter(c => c.process_state === "Running").length,
            waiting_cases: cases.filter(c => c.process_state === "Waiting").length,
            available_resource_types: resources.length,
            resource_units_available: resources.reduce(
                (total, resource) => total + Number(resource.available_quantity || 0),
                0
            )
        };

        return res.json({
            success: true,
            staff: {
                staff_id: staff.staff_id,
                staff_name: staff.staff_name,
                role: staff.role,
                hospital_id: staff.hospital_id
            },
            summary,
            cases,
            resources
        });
    } catch (error) {
        console.error("Staff dashboard error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to fetch staff dashboard" });
    }
});

// GET: Queue entries for this hospital
router.get("/:staff_id/queue", requireAuth(["staff", "admin"]), async (req, res) => {
    try {
        const staffId = Number(req.params.staff_id);

        if (!Number.isSafeInteger(staffId) || staffId <= 0) {
            return res.status(400).json({ success: false, message: "Invalid staff ID" });
        }

        if (req.user.role === "staff" && Number(req.user.sid) !== staffId) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        const [staffMembers] = await pool.query(
            `SELECT staff_id, staff_name, hospital_id
             FROM medical_staff
             WHERE staff_id = ?`,
            [staffId]
        );

        if (!staffMembers.length) {
            return res.status(404).json({ success: false, message: "Staff member not found" });
        }

        const staff = staffMembers[0];

        const [queue] = await pool.query(
            `SELECT qe.queue_entry_id, qe.case_id, ec.case_code,
                    ec.case_type, ec.triage_level, ec.priority,
                    ec.process_state, qe.queue_type,
                    qe.queue_position, qe.queue_status, qe.entered_at
             FROM queue_entries qe
             JOIN emergency_cases ec ON ec.case_id = qe.case_id
             WHERE qe.hospital_id = ?
               AND qe.queue_status = 'QUEUED'
               AND qe.removed_at IS NULL
             ORDER BY qe.queue_position ASC, qe.entered_at ASC`,
            [staff.hospital_id]
        );

        return res.json({
            success: true,
            hospital_id: staff.hospital_id,
            count: queue.length,
            data: queue
        });
    } catch (error) {
        console.error("Staff queue error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to fetch hospital queue" });
    }
});

module.exports = router;