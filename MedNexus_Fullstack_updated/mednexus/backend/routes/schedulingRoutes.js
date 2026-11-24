
const express = require("express");
const router = express.Router();

const { runScheduling } = require("../schedulerService");
const pool = require("../db");
const { canActOnHospital } = require("../auth");

// POST: Run an OS scheduling algorithm
router.post("/run", async (req, res) => {
    try {
        const {
            hospitalId,
            algorithm,
            timeQuantum,
            agingWaitingLimit,
            starvationMaxWait
        } = req.body;
        const optionalInt = value =>
            value === undefined || value === null || value === "" ? null : Number(value);

        if (
            hospitalId === undefined ||
            hospitalId === null ||
            !algorithm
        ) {
            return res.status(400).json({
                success: false,
                message: "hospitalId and algorithm are required"
            });
        }

        const id = Number(hospitalId);

        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({
                success: false,
                message: "hospitalId must be a positive integer"
            });
        }

        if (!canActOnHospital(req.user, id)) {
            return res.status(403).json({
                success: false,
                message: "You can only schedule your own hospital"
            });
        }

        const allowedAlgorithms = [
            "FCFS",
            "SJF",
            "PRIORITY",
            "ROUND_ROBIN"
        ];

        if (!allowedAlgorithms.includes(algorithm)) {
            return res.status(400).json({
                success: false,
                message: "Invalid scheduling algorithm"
            });
        }

        let quantum = null;

        if (algorithm === "ROUND_ROBIN") {
            quantum = Number(timeQuantum);

            if (
                timeQuantum === undefined ||
                timeQuantum === null ||
                !Number.isInteger(quantum) ||
                quantum <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Round Robin requires a positive timeQuantum"
                });
            }
        }

        const result = await runScheduling({
            hospitalId: id,
            algorithm,
            timeQuantum: quantum,
            agingWaitingLimit: optionalInt(agingWaitingLimit),
            starvationMaxWait: optionalInt(starvationMaxWait)
        });

        return res.json({
            success: true,
            message: result.results.length
                ? "Scheduling completed successfully"
                : "No eligible cases found for this hospital",
            data: result
        });

    } catch (error) {
        console.error("Scheduling error:", error.message);

        return res.status(500).json({
            success: false,
            message: error.message || "Failed to run scheduling"
        });
    }
});

const { dispatchNext } = require("../dispatcher");

// POST: pick the next patient and give resources
router.post("/next", async (req, res) => {
    try {
        const hospitalId = Number(req.body.hospitalId);

        if (!Number.isSafeInteger(hospitalId) || hospitalId <= 0) {
            return res.status(400).json({
                success: false,
                message: "hospitalId must be a positive integer"
            });
        }

        if (!canActOnHospital(req.user, hospitalId)) {
            return res.status(403).json({
                success: false,
                message: "You can only dispatch for your own hospital"
            });
        }

        const result = await dispatchNext(hospitalId);
        return res.json({ success: true, data: result });
    } catch (error) {
        console.error("Dispatch error:", error.message);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
