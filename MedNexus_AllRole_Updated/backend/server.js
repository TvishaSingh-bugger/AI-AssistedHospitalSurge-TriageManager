require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./db");
const { requireAuth } = require("./auth");

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",")
      : true
  })
);

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
    message: "MedNexus API is running",
    database,
    uptime_seconds: Math.round(process.uptime())
  });
});

const STAFF_SIDE = ["staff", "doctor", "admin"];

// Authentication routes
app.use("/api/auth", require("./routes/authRoutes"));

// Portal, admin and forecasting routes
app.use("/api/portal", require("./routes/portalRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/forecast", require("./routes/forecastRoutes"));

// Hospital routes
app.use("/api/hospitals/admin", requireAuth(["admin"]));
app.use("/api/hospitals", require("./routes/hospitalRoutes"));

// Resource and domain routes
app.use("/api/resources", requireAuth(STAFF_SIDE), require("./routes/resourceRoutes"));
app.use("/api/patients", requireAuth(STAFF_SIDE), require("./routes/patientRoutes"));
app.use("/api/cases", requireAuth(STAFF_SIDE), require("./routes/caseRoutes"));
app.use("/api/doctors", requireAuth(STAFF_SIDE), require("./routes/doctorRoutes"));
app.use("/api/staff", requireAuth(STAFF_SIDE), require("./routes/staffRoutes"));

// Appointment routes handle their own authentication
app.use("/api/appointments", require("./routes/appointmentRoutes"));

// Scheduling
app.use("/api/scheduling", requireAuth(["staff", "admin"]), require("./routes/schedulingRoutes"));

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found"
  });
});

// Error handler
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON request body"
    });
  }

  console.error("Unhandled server error:", error.message);

  return res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

// Database connectivity check
pool.query("SELECT 1")
  .then(() => console.log("MySQL connection OK"))
  .catch(error => {
    console.error(
      `\nCould not connect to MySQL: ${error.code || error.message}`
    );
    console.error(
      "Check DB_HOST / DB_USER / DB_PASSWORD / DB_NAME in backend/.env and ensure MySQL is running.\n"
    );
  });

app.listen(PORT, () => {
  console.log(`MedNexus API running at http://localhost:${PORT}`);
});