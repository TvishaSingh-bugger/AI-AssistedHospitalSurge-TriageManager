require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./db");
const { requireAuth } = require("./auth");

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true }));
app.use(express.json());

app.get("/api/health", async (req, res) => {
    let database = "connected";
    try {
        await pool.query("SELECT 1");
    } catch (error) {
        database = `unreachable (${error.code || error.message})`;
    }
    res.status(database === "connected" ? 200 : 503).json({
        success: database === "connected",
        message: "Hospital Surge Triage Manager API is running",
        database,
        uptime_seconds: Math.round(process.uptime())
    });
});

const STAFF_SIDE = ["staff", "doctor", "admin"];

// Public: login / register / guest emergency login
app.use("/api/auth", require("./routes/authRoutes"));

// Frontend adapter, admin tools and forecasting (each file applies its own role checks)
app.use("/api/portal", require("./routes/portalRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/forecast", require("./routes/forecastRoutes"));

// Original domain routes, now behind login + role checks
app.use("/api/hospitals/admin", requireAuth(["admin"]));
app.use("/api/hospitals", requireAuth(), require("./routes/hospitalRoutes"));
app.use("/api/resources", requireAuth(STAFF_SIDE), require("./routes/resourceRoutes"));
app.use("/api/patients", requireAuth(STAFF_SIDE), require("./routes/patientRoutes"));
app.use("/api/cases", requireAuth(STAFF_SIDE), require("./routes/caseRoutes"));
app.use("/api/doctors", requireAuth(STAFF_SIDE), require("./routes/doctorRoutes"));
app.use("/api/staff", requireAuth(STAFF_SIDE), require("./routes/staffRoutes"));
app.use("/api/appointments", requireAuth(STAFF_SIDE), require("./routes/appointmentRoutes"));
app.use("/api/scheduling", requireAuth(["staff", "admin"]), require("./routes/schedulingRoutes"));

app.use((req, res) => {
    res.status(404).json({ success: false, message: "Route not found" });
});

app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
        return res.status(400).json({ success: false, message: "Invalid JSON request body" });
    }
    console.error("Unhandled server error:", error.message);
    return res.status(500).json({ success: false, message: "Internal server error" });
});

pool.query("SELECT 1")
    .then(() => console.log("MySQL connection OK"))
    .catch(error => {
        console.error(`\nCould not connect to MySQL: ${error.code || error.message}`);
        console.error("Check DB_HOST / DB_USER / DB_PASSWORD / DB_NAME in backend/.env and that MySQL is running.\n");
    });

app.listen(PORT, () => {
    console.log(`MedNexus API running at http://localhost:${PORT}`);
});
