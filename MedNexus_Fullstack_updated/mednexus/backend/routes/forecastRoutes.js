// Arrival forecasting built from the historical emergency_cases (including the synthetic
// ML training patch). Method: seasonal average by time of day - for each 30-minute slot,
// the average number of cases (and critical cases) seen in that slot over the last 28 days
// of data. It is a transparent statistical baseline, not a trained model.
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth, canActOnHospital } = require("../auth");

router.use(requireAuth(["staff", "doctor", "admin"]));

const HISTORY_DAYS = 28;

router.get("/hospitals/:id", async (req, res) => {
  try {
    const hospitalId = Number(req.params.id);
    const horizonHours = Math.min(Math.max(parseInt(req.query.hours, 10) || 6, 1), 24);
    if (!Number.isSafeInteger(hospitalId) || hospitalId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid hospital ID" });
    }
    if (!canActOnHospital(req.user, hospitalId)) {
      return res.status(403).json({ success: false, message: "This is another hospital's data" });
    }

    const [[range]] = await pool.query(
      "SELECT MAX(arrival_time) AS latest FROM emergency_cases WHERE hospital_id = ?",
      [hospitalId]
    );
    if (!range.latest) {
      return res.json({ success: true, data: { available: false, message: "No historical cases for this hospital" } });
    }

    const [[span]] = await pool.query(
      `SELECT COUNT(DISTINCT DATE(arrival_time)) AS days
       FROM emergency_cases
       WHERE hospital_id = ? AND arrival_time > ? - INTERVAL ? DAY`,
      [hospitalId, range.latest, HISTORY_DAYS]
    );
    const days = Math.max(1, Number(span.days));

    const [slots] = await pool.query(
      `SELECT (HOUR(arrival_time) * 2 + FLOOR(MINUTE(arrival_time) / 30)) AS slot,
              COUNT(*) AS n, SUM(triage_level = 'Critical') AS critical
       FROM emergency_cases
       WHERE hospital_id = ? AND arrival_time > ? - INTERVAL ? DAY
       GROUP BY slot`,
      [hospitalId, range.latest, HISTORY_DAYS]
    );
    const avg = new Array(48).fill(0);
    const avgCritical = new Array(48).fill(0);
    for (const s of slots) {
      avg[s.slot] = Number(s.n) / days;
      avgCritical[s.slot] = Number(s.critical) / days;
    }

    const [inventory] = await pool.query(
      `SELECT resource_type, SUM(available_quantity) AS available, SUM(total_quantity) AS total
       FROM resource_inventory WHERE hospital_id = ? AND resource_type IN ('ICU_BED','VENTILATOR')
       GROUP BY resource_type`,
      [hospitalId]
    );
    const icu = Number(inventory.find(r => r.resource_type === "ICU_BED")?.available || 0);
    const vent = Number(inventory.find(r => r.resource_type === "VENTILATOR")?.available || 0);

    // Walk forward from the current half-hour slot.
    const now = new Date();
    now.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);
    const horizon = [];
    let expectedTotal = 0;
    let expectedCritical = 0;
    for (let i = 0; i < horizonHours * 2; i++) {
      const start = new Date(now.getTime() + i * 30 * 60000);
      const slot = start.getHours() * 2 + (start.getMinutes() >= 30 ? 1 : 0);
      expectedTotal += avg[slot];
      expectedCritical += avgCritical[slot];
      horizon.push({
        start: start.toISOString(),
        expected_cases: Math.round(avg[slot] * 100) / 100,
        expected_critical: Math.round(avgCritical[slot] * 100) / 100
      });
    }

    // Critical patients need an ICU bed; compare demand with what is free right now.
    const demand = expectedCritical;
    const capacity = Math.max(1, Math.min(icu, vent || icu));
    const ratio = demand / capacity;
    const risk = ratio >= 1 ? "HIGH" : ratio >= 0.6 ? "MEDIUM" : "LOW";

    res.json({
      success: true,
      data: {
        available: true,
        method: "seasonal average by 30-minute slot of day",
        history_days_used: days,
        history_ends: range.latest,
        horizon_hours: horizonHours,
        expected_cases: Math.round(expectedTotal * 10) / 10,
        expected_critical_cases: Math.round(expectedCritical * 10) / 10,
        icu_available: icu,
        ventilators_available: vent,
        risk,
        slots: horizon
      }
    });
  } catch (error) {
    console.error("Forecast error:", error.message);
    res.status(500).json({ success: false, message: "Failed to build forecast" });
  }
});

module.exports = router;
