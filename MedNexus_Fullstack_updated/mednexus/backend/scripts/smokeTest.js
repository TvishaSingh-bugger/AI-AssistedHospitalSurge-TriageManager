// End-to-end API check against a RUNNING backend:  npm run smoke-test
// Logs in as every demo role and exercises the main workflows. Creates a little test data.
// Usage: node scripts/smokeTest.js [baseUrl]    (default http://localhost:5000)
const BASE = (process.argv[2] || "http://localhost:5000").replace(/\/$/, "");
const PASSWORD = "Demo@123";

let passed = 0;
let failed = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = {};
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, ...json };
}

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

async function login(email, role) {
  const r = await call("POST", "/api/auth/login", { body: { email, password: PASSWORD, role } });
  return { token: r.token, user: r.user, status: r.status };
}

async function main() {
  console.log(`MedNexus smoke test against ${BASE}\n`);

  console.log("Health & auth");
  const health = await call("GET", "/api/health");
  check("health reports database connected", health.status === 200 && health.database === "connected");
  check("protected route without token -> 401", (await call("GET", "/api/portal/hospitals")).status === 401);
  const bad = await call("POST", "/api/auth/login", { body: { email: "admin@mednexus.com", password: "wrong" } });
  check("wrong password -> 401", bad.status === 401);
  const wrongRole = await login("admin@mednexus.com", "patient");
  check("right password but wrong role tab -> 403", wrongRole.status === 403);

  const admin = await login("admin@mednexus.com", "admin");
  const staff = await login("rashi@mednexus.com", "staff");
  const doctor = await login("arjun@mednexus.com", "doctor");
  const patient = await login("simran@mail.com", "patient");
  check("demo logins work for all four roles", admin.token && staff.token && doctor.token && patient.token);
  check("staff user is bound to a hospital", staff.user.hospital_id === 1 && staff.user.staff_id > 0);

  console.log("\nRole protection");
  check("patient cannot read hospital records", (await call("GET", "/api/portal/hospitals/1/records", { token: patient.token })).status === 403);
  check("staff cannot read another hospital", (await call("GET", "/api/portal/hospitals/2/records", { token: staff.token })).status === 403);
  check("staff cannot use admin API", (await call("GET", "/api/admin/users", { token: staff.token })).status === 403);
  check("patient cannot run scheduling", (await call("POST", "/api/scheduling/run", { token: patient.token, body: { hospitalId: 1, algorithm: "FCFS" } })).status === 403);

  console.log("\nHospitals & resources");
  const hospitals = await call("GET", "/api/portal/hospitals", { token: patient.token });
  check("hospital list returned (299 in dataset)", hospitals.count >= 299, `got ${hospitals.count}`);
  const h1 = hospitals.data.find(h => h.id === 1);
  check("hospital 1 has all five resource types", h1 && h1.icu[1] > 0 && h1.vent[1] > 0 && h1.oxy[1] > 0 && h1.beds[1] > 0 && h1.blood[1] > 0, JSON.stringify(h1));
  const docs = await call("GET", "/api/portal/hospitals/1/doctors", { token: patient.token });
  check("hospital 1 has doctors", docs.data.length > 0);

  console.log("\nPatient emergency -> staff queue -> start -> complete (resources must be released)");
  const before = (await call("GET", "/api/portal/hospitals", { token: staff.token })).data.find(h => h.id === 1);
  const mine0 = await call("GET", "/api/portal/me", { token: patient.token });
  // clean up any previous run's active emergency for this demo patient
  for (const r of mine0.records.filter(r => r.kind === "case" && !["Completed", "Cancelled"].includes(r.status))) {
    await call("POST", `/api/portal/records/case/${r.id}/cancel`, { token: patient.token });
  }
  const emergency = await call("POST", "/api/portal/emergency", {
    token: patient.token, body: { hospital_id: 1, severity: "Critical", need: "ICU + Ventilator", reason: "Smoke test chest pain" }
  });
  check("emergency registered", emergency.status === 201, emergency.message);
  const dupe = await call("POST", "/api/portal/emergency", { token: patient.token, body: { hospital_id: 1, severity: "High", need: "ICU" } });
  check("second active emergency rejected (409)", dupe.status === 409);

  const records = await call("GET", "/api/portal/hospitals/1/records", { token: staff.token });
  const caseRec = records.data.find(r => r.kind === "case" && r.id === emergency.data.case_id);
  check("staff sees the case with name, severity, need", caseRec && caseRec.name === "Simran Preet Kaur" && caseRec.severity === "Critical" && caseRec.need === "ICU + Ventilator", JSON.stringify(caseRec));

  const started = await call("PUT", `/api/portal/records/case/${emergency.data.case_id}/status`, { token: doctor.token, body: { status: "Running" } });
  check("doctor starts case (resources allocated)", started.success && started.outcome === "RUNNING", started.message);
  const during = (await call("GET", "/api/portal/hospitals", { token: staff.token })).data.find(h => h.id === 1);
  check("ICU bed and ventilator consumed", during.icu[0] === before.icu[0] - 1 && during.vent[0] === before.vent[0] - 1, `${before.icu}->${during.icu} / ${before.vent}->${during.vent}`);

  const done = await call("PUT", `/api/portal/records/case/${emergency.data.case_id}/status`, { token: doctor.token, body: { status: "Completed" } });
  check("doctor completes case", done.success, done.message);
  const after = (await call("GET", "/api/portal/hospitals", { token: staff.token })).data.find(h => h.id === 1);
  check("resources released back", after.icu[0] === before.icu[0] && after.vent[0] === before.vent[0], `${after.icu} / ${after.vent}`);
  const again = await call("PUT", `/api/portal/records/case/${emergency.data.case_id}/status`, { token: doctor.token, body: { status: "Running" } });
  check("completed case cannot be restarted (409)", again.status === 409);

  console.log("\nAppointments");
  const doctorId = docs.data[0].staff_id;
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const slot = `${String(8 + Math.floor(Math.random() * 10)).padStart(2, "0")}:${Math.random() < 0.5 ? "00" : "30"}`;
  const booked = await call("POST", "/api/portal/appointments", {
    token: patient.token, body: { hospital_id: 1, doctor_id: doctorId, date: day, time: slot, reason: "Smoke test checkup" }
  });
  check("appointment booked", booked.status === 201 || booked.status === 409, booked.message);
  if (booked.status === 201) {
    const clash = await call("POST", "/api/portal/appointments", {
      token: patient.token, body: { hospital_id: 1, doctor_id: doctorId, date: day, time: slot }
    });
    check("same doctor/time rejected (409)", clash.status === 409);
    const past = await call("POST", "/api/portal/appointments", {
      token: patient.token, body: { hospital_id: 1, doctor_id: doctorId, date: "2020-01-01", time: "10:00" }
    });
    check("past date rejected (400)", past.status === 400);
    const confirm = await call("PUT", `/api/portal/records/appt/${booked.data.appointment_id}/status`, { token: doctor.token, body: { status: "Confirmed" } });
    check("doctor confirms appointment", confirm.success);
    const cancel = await call("POST", `/api/portal/records/appt/${booked.data.appointment_id}/cancel`, { token: patient.token });
    check("patient cancels appointment", cancel.success);
  }

  console.log("\nStaff walk-in & prescriptions");
  const walk = await call("POST", "/api/portal/hospitals/1/walk-in", {
    token: staff.token, body: { name: "Smoke Walkin", age: 41, type: "Emergency", severity: "High", need: "Oxygen", reason: "Breathing issue" }
  });
  check("staff registers an emergency walk-in", walk.status === 201, walk.message);
  const walk2 = await call("POST", "/api/portal/hospitals/1/walk-in", {
    token: staff.token, body: { name: "Smoke Regular", age: 30, type: "Regular", reason: "Fever" }
  });
  check("staff registers a regular walk-in (auto-booked)", walk2.status === 201, walk2.message);
  const recs = await call("GET", "/api/portal/hospitals/1/records", { token: doctor.token });
  const walkRec = recs.data.find(r => r.name === "Smoke Walkin");
  const rx = await call("POST", "/api/portal/prescriptions", { token: doctor.token, body: { patient_id: walkRec.patient_id, medicine: "Paracetamol 500mg", notes: "Twice daily" } });
  check("doctor writes prescription", rx.status === 201, rx.message);
  const rxList = await call("GET", "/api/portal/hospitals/1/prescriptions", { token: doctor.token });
  check("prescription listed", rxList.data.some(r => r.medicine === "Paracetamol 500mg"));

  console.log("\nScheduling");
  for (const body of [
    { algorithm: "FCFS" }, { algorithm: "SJF" }, { algorithm: "PRIORITY" }, { algorithm: "ROUND_ROBIN", timeQuantum: 3 }
  ]) {
    const run = await call("POST", "/api/scheduling/run", { token: staff.token, body: { hospitalId: 1, ...body } });
    check(`${body.algorithm} run saved`, run.success && run.data.results.length > 0 && run.data.runId, run.message);
  }
  const next = await call("POST", "/api/scheduling/next", { token: staff.token, body: { hospitalId: 1 } });
  check("dispatch next case", next.success && ["RUNNING", "WAITING", "EMPTY"].includes(next.data.status), JSON.stringify(next));
  if (next.data && next.data.caseId) {
    await call("PUT", `/api/portal/records/case/${next.data.caseId}/status`, { token: staff.token, body: { status: "Completed" } });
  }

  console.log("\nForecast & admin");
  const fc = await call("GET", "/api/forecast/hospitals/1?hours=6", { token: staff.token });
  check("forecast returned", fc.success && fc.data.available && fc.data.slots.length === 12, fc.message);
  const overview = await call("GET", "/api/admin/overview", { token: admin.token });
  check("admin overview", overview.success && overview.data.hospitals >= 299);
  const email = `smoke${Date.now()}@test.com`;
  const newUser = await call("POST", "/api/admin/users", { token: admin.token, body: { full_name: "Smoke Doc", email, password: PASSWORD, role: "doctor", hospital_id: 3 } });
  check("admin creates a doctor account", newUser.status === 201, newUser.message);
  const loginNew = await login(email, "doctor");
  check("new doctor can log in", !!loginNew.token);
  check("admin deletes the account", (await call("DELETE", `/api/admin/users/${newUser.data.user_id}`, { token: admin.token })).success);
  const reg = await call("POST", "/api/auth/register", { body: { full_name: "Smoke Patient", email: `p${Date.now()}@test.com`, password: "secret1" } });
  check("patient self-registration", reg.status === 201 && reg.token);
  const guest = await call("POST", "/api/auth/guest");
  check("guest emergency login", guest.status === 201 && guest.user.is_guest);
  const hosp = await call("POST", "/api/admin/hospitals", { token: admin.token, body: { name: `Smoke Hospital ${Date.now()}`, district: "Test", total_beds: 40 } });
  check("admin adds a hospital", hosp.status === 201, hosp.message);
  if (hosp.data) check("admin removes the new hospital", (await call("DELETE", `/api/admin/hospitals/${hosp.data.hospital_id}`, { token: admin.token })).success);
  check("dataset hospital cannot be removed", (await call("DELETE", "/api/admin/hospitals/1", { token: admin.token })).status === 409);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(error => {
  console.error("Smoke test crashed:", error.message);
  process.exit(1);
});
