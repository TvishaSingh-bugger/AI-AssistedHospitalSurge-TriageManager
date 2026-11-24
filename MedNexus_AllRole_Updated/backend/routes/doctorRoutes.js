const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth } = require("../auth");
const { completeCase, startCase } = require("../dispatcher");

// GET /api/doctors/:doctor_id/queue
router.get("/:doctor_id/queue", requireAuth(["doctor", "admin"]), async (req, res) => {
    try {
        const doctorId = Number(req.params.doctor_id);

        if (!Number.isSafeInteger(doctorId) || doctorId <= 0) {
            return res.status(400).json({ success: false, message: "Invalid doctor ID" });
        }

        if (req.user.role === "doctor" && Number(req.user.sid) !== doctorId) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        const [doctors] = await pool.query(
            `SELECT staff_id, hospital_id, staff_name, role
             FROM medical_staff
             WHERE staff_id = ? AND role = 'Doctor'`,
            [doctorId]
        );

        if (!doctors.length) {
            return res.status(404).json({ success: false, message: "Doctor not found" });
        }

        const doctor = doctors[0];

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
            [doctor.hospital_id]
        );

        return res.json({
            success: true,
            doctor: {
                staff_id: doctor.staff_id,
                staff_name: doctor.staff_name,
                hospital_id: doctor.hospital_id
            },
            count: cases.length,
            data: cases
        });
    } catch (error) {
        console.error("Doctor queue error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to fetch doctor queue" });
    }
});

// GET /api/doctors/:doctor_id/appointments
router.get("/:doctor_id/appointments", requireAuth(["doctor", "admin"]), async (req, res) => {
    try {
        const doctorId = Number(req.params.doctor_id);

        if (!Number.isSafeInteger(doctorId) || doctorId <= 0) {
            return res.status(400).json({ success: false, message: "Invalid doctor ID" });
        }

        if (req.user.role === "doctor" && Number(req.user.sid) !== doctorId) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        const [doctors] = await pool.query(
            `SELECT staff_id, hospital_id, staff_name
             FROM medical_staff
             WHERE staff_id = ? AND role = 'Doctor'`,
            [doctorId]
        );

        if (!doctors.length) {
            return res.status(404).json({ success: false, message: "Doctor not found" });
        }

        const [appointments] = await pool.query(
            `SELECT a.appointment_id, a.patient_id, p.patient_code,
                    p.age, p.sex, a.hospital_id, h.hospital_name,
                    a.appointment_date, a.reason,
                    a.appointment_status, a.created_at
             FROM appointments a
             JOIN patients p ON p.patient_id = a.patient_id
             JOIN hospitals h ON h.hospital_id = a.hospital_id
             WHERE a.doctor_id = ?
             ORDER BY a.appointment_date ASC`,
            [doctorId]
        );

        return res.json({
            success: true,
            doctor: doctors[0],
            count: appointments.length,
            data: appointments
        });
    } catch (error) {
        console.error("Doctor appointments error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to fetch doctor appointments" });
    }
});

// PUT /api/doctors/cases/:case_id/status
router.put("/cases/:case_id/status", requireAuth(["doctor", "admin"]), async (req, res) => {
    try {
        const caseId = Number(req.params.case_id);
        const processState = req.body.process_state;

        const allowedStates = ["Ready", "Running", "Waiting", "Completed", "Cancelled"];

        if (!Number.isSafeInteger(caseId) || caseId <= 0) {
            return res.status(400).json({ success: false, message: "Invalid case ID" });
        }

        if (!allowedStates.includes(processState)) {
            return res.status(400).json({ success: false, message: "Invalid case status" });
        }

        const [cases] = await pool.query(
            `SELECT case_id, hospital_id, process_state
             FROM emergency_cases
             WHERE case_id = ?`,
            [caseId]
        );

        if (!cases.length) {
            return res.status(404).json({ success: false, message: "Emergency case not found" });
        }

        const emergencyCase = cases[0];

        if (req.user.role === "doctor") {
            const [staff] = await pool.query(
                `SELECT staff_id
                 FROM medical_staff
                 WHERE staff_id = ? AND hospital_id = ? AND role = 'Doctor'`,
                [req.user.sid, emergencyCase.hospital_id]
            );

            if (!staff.length) {
                return res.status(403).json({ success: false, message: "Access denied" });
            }
        }

        if (["Completed", "Cancelled"].includes(emergencyCase.process_state)) {
            return res.status(409).json({
                success: false,
                message: "Completed or cancelled cases cannot be changed"
            });
        }

        if (["Completed", "Cancelled"].includes(processState)) {
            const result = await completeCase(caseId, processState);

            return res.json({
                success: true,
                message: "Case finished and resources released",
                case_id: caseId,
                process_state: processState,
                data: result
            });
        }

        if (processState === "Running") {
            const result = await startCase(caseId);

            return res.json({
                success: true,
                message: result.status === "RUNNING"
                    ? "Case started and resources allocated"
                    : "Not enough resources - case is waiting",
                case_id: caseId,
                process_state: result.status === "RUNNING" ? "Running" : "Waiting",
                data: result
            });
        }

        await pool.query(
            `UPDATE emergency_cases
             SET process_state = ?
             WHERE case_id = ?`,
            [processState, caseId]
        );

        return res.json({
            success: true,
            message: "Emergency case status updated",
            case_id: caseId,
            process_state: processState
        });
    } catch (error) {
        console.error("Doctor case status error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to update case status" });
    }
});

// PUT /api/doctors/appointments/:appointment_id/status
router.put("/appointments/:appointment_id/status", requireAuth(["doctor", "admin"]), async (req, res) => {
    try {
        const appointmentId = Number(req.params.appointment_id);
        const status = req.body.appointment_status;

        const allowedStatuses = ["Confirmed", "In Progress", "Completed", "Cancelled"];

        if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) {
            return res.status(400).json({ success: false, message: "Invalid appointment ID" });
        }

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid appointment status" });
        }

        const [appointments] = await pool.query(
            `SELECT appointment_id, appointment_status, doctor_id, hospital_id
             FROM appointments
             WHERE appointment_id = ?`,
            [appointmentId]
        );

        if (!appointments.length) {
            return res.status(404).json({ success: false, message: "Appointment not found" });
        }

        const appointment = appointments[0];

        if (req.user.role === "doctor" && Number(req.user.sid) !== Number(appointment.doctor_id)) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        if (["Completed", "Cancelled"].includes(appointment.appointment_status)) {
            return res.status(409).json({
                success: false,
                message: "Completed or cancelled appointments cannot be changed"
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
            appointment_id: appointmentId,
            appointment_status: status
        });
    } catch (error) {
        console.error("Doctor appointment status error:", error.message);
        return res.status(500).json({ success: false, message: "Failed to update appointment status" });
    }
});

module.exports = router;