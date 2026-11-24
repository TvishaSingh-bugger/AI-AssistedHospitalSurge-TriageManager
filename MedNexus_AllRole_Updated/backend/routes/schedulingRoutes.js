const express = require("express");
const router = express.Router();

const { runScheduling } = require("../schedulerService");
const { canActOnHospital, requireAuth } = require("../auth");
const { dispatchNext } = require("../dispatcher");

const STAFF_SIDE = ["staff", "admin"];

// POST /api/scheduling/run
router.post("/run", requireAuth(STAFF_SIDE), async (req, res) => {
    try {
        const {
            hospitalId,
            algorithm,
            timeQuantum,
            agingWaitingLimit,
            starvationMaxWait
        } = req.body;

        const optionalInt = value =>
            value === undefined || value === null || value === ""
                ? null
                : Number(value);

        if (hospitalId == null || !algorithm) {
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

        if (!(canActOnHospital(req.user, id))) {
            return res.status(403).json({
                success: false,
                message: "You can only schedule your own hospital"
            });
        }

        const allowedAlgorithms = ["FCFS", "SJF", "PRIORITY", "ROUND_ROBIN"];

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
                timeQuantum == null ||
                !Number.isInteger(quantum) ||
                quantum <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Round Robin requires a positive timeQuantum"
                });
            }
        }

        const agingLimit = optionalInt(agingWaitingLimit);
        const starvationLimit = optionalInt(starvationMaxWait);

        if (
            (agingLimit !== null && (!Number.isFinite(agingLimit) || agingLimit < 0)) ||
            (starvationLimit !== null && (!Number.isFinite(starvationLimit) || starvationLimit < 0))
        ) {
            return res.status(400).json({
                success: false,
                message: "Aging and starvation limits must be non-negative numbers"
            });
        }

        const result = await runScheduling({
            hospitalId: id,
            algorithm,
            timeQuantum: quantum,
            agingWaitingLimit: agingLimit,
            starvationMaxWait: starvationLimit
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

// POST /api/scheduling/next
router.post("/next", requireAuth(STAFF_SIDE), async (req, res) => {
    try {
        const hospitalId = Number(req.body.hospitalId);

        if (!Number.isSafeInteger(hospitalId) || hospitalId <= 0) {
            return res.status(400).json({
                success: false,
                message: "hospitalId must be a positive integer"
            });
        }

        if (!( canActOnHospital(req.user, hospitalId))) {
            return res.status(403).json({
                success: false,
                message: "You can only dispatch for your own hospital"
            });
        }

        const result = await dispatchNext(hospitalId);

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error("Dispatch error:", error.message);

        return res.status(500).json({
            success: false,
            message: error.message || "Failed to dispatch next case"
        });
    }
});

module.exports = router;