
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const pool = require("../db");

router.post("/register", async (req, res) => {
    try {
        const { hospital_id, age, sex } = req.body;


        if (!hospital_id) {
            return res.status(400).json({
                success: false,
                message: "Hospital ID is required"
            });
        }


        const hospitalId = Number(hospital_id);

        if (!Number.isSafeInteger(hospitalId) || hospitalId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Hospital ID must be a positive integer"
            });
        }

        let patientAge = null;

        if (age !== undefined && age !== null && age !== "") {
            patientAge = Number(age);

            if (!Number.isInteger(patientAge) ||
                patientAge < 0 || patientAge > 255) {
                return res.status(400).json({
                    success: false,
                    message: "Age must be an integer between 0 and 255"
                });
            }
        }


        const allowedSex = [
            "Female",
            "Male",
            "Other",
            "Prefer not to say"
        ];

        if (sex !== undefined && sex !== null &&
            sex !== "" && !allowedSex.includes(sex)) {
            return res.status(400).json({
                success: false,
                message: "Invalid sex value"
            });
        }

        const patientSex = sex || null;


        const [hospitals] = await pool.query(
            "SELECT hospital_id FROM hospitals WHERE hospital_id = ?",
            [hospitalId]
        );

        if (hospitals.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Hospital not found"
            });
        }

        let patientCode;
        let existing;

        do {
            patientCode =
                "PT-" + crypto.randomBytes(8).toString("hex").toUpperCase();

            [existing] = await pool.query(
                "SELECT patient_id FROM patients WHERE patient_code = ?",
                [patientCode]
            );
        } while (existing.length > 0);

        // Insert patient into MySQL
        const [result] = await pool.query(
            `INSERT INTO patients
                (hospital_id, patient_code, age, sex,
                 registered_at, is_synthetic)
             VALUES (?, ?, ?, ?, NOW(), 0)`,
            [hospitalId, patientCode, patientAge, patientSex]
        );

        res.status(201).json({
            success: true,
            message: "Patient registered successfully",
            data: {
                patient_id: result.insertId,
                patient_code: patientCode,
                hospital_id: hospitalId,
                age: patientAge,
                sex: patientSex
            }
        });

    } catch (error) {
        console.error("Patient registration error:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to register patient"
        });
    }
});


 // GET: Check the status of a patient's emergency case
router.get("/:patient_id/cases", async (req, res) => {
    try {
        const patientId = Number(req.params.patient_id);

        if (!Number.isSafeInteger(patientId) || patientId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid patient ID"
            });
        }

        const [patients] = await pool.query(
            `SELECT patient_id, patient_code
             FROM patients
             WHERE patient_id = ?`,
            [patientId]
        );

        if (patients.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Patient not found"
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
            patient: patients[0],
            count: cases.length,
            data: cases
        });

    } catch (error) {
        console.error("Patient status error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch patient case status"
        });
    }
});


module.exports = router;
