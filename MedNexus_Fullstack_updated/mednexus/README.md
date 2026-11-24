# MedNexus - Hospital Surge & Triage Manager (fully integrated)

A working full-stack project that joins the three things you supplied:

| Layer | Technology | Folder |
|---|---|---|
| Database | MySQL 8.x (`hospital_surge_db`) | `database/` |
| Backend API | Node.js + Express 5 + mysql2 | `backend/` |
| Frontend | React 18 + Vite + React Router | `frontend/` |

The React app no longer uses fake `localStorage` data: every screen reads and writes the real MySQL database through the Express API, with real login and role-based access (patient / staff / doctor / administrator).

---

## 1. Run it on your PC (step by step)

### 1.1 Install once
1. **Node.js LTS** (18 or newer) - https://nodejs.org  (check: `node -v`)
2. **MySQL Server 8.x** - you already have it (MySQL Workbench is optional). Know your MySQL `root` password.

### 1.2 Easiest way (Windows)
1. Unzip the project, e.g. to `C:\mednexus`.
2. Double-click **`setup.bat`**. It installs everything, creates `backend\.env` and opens it in Notepad - **type your MySQL password after `DB_PASSWORD=`**, save, close. It then creates and fills the database (the first time this takes 1-3 minutes because of the ~437,000-row ML history patch).
3. Double-click **`start.bat`**. Two windows open (backend + frontend) and your browser opens http://localhost:5173.
4. Log in with the demo accounts below.

### 1.3 Manual way (any OS)
```bash
# 1) backend
cd backend
npm install
cp .env.example .env          # Windows: copy .env.example .env   -> then edit .env and set DB_PASSWORD
npm run setup-db              # creates tables + data + demo users (1-3 min first time)
npm start                     # API on http://localhost:5000

# 2) frontend (new terminal)
cd frontend
npm install
npm run dev                   # app on http://localhost:5173
```
Open **http://localhost:5173**.

### 1.4 Demo accounts (password for all: `Demo@123`)
| Role | Email | Bound to |
|---|---|---|
| Administrator | `admin@mednexus.com` | whole system |
| Doctor | `arjun@mednexus.com` | Hospital 1 (Pandit Hargovind Pant District Hospital, Almora) |
| Doctor | `neha@mednexus.com` | Hospital 2 (CHC Chaukhutia) |
| Staff | `rashi@mednexus.com` | Hospital 1 |
| Staff | `vikas@mednexus.com` | Hospital 2 |
| Patient | `simran@mail.com` | - |

Patients can also **register** on the login page, and **Emergency Login** creates a temporary guest patient with no password. The Administrator can create more staff/doctor accounts (each gets a hospital and a linked `medical_staff` row).

### 1.5 Useful commands (in `backend/`)
| Command | What it does |
|---|---|
| `npm start` | start the API |
| `npm run dev` | start the API and restart on file changes |
| `npm run setup-db` | create/complete the database (keeps existing data) |
| `npm run setup-db:reset` | **wipe and rebuild** the whole database |
| `npm run setup-db:no-ml` | skip the large ML history patch (fast, but forecasts then have no history) |
| `npm run seed-users` | (re)create missing demo accounts |
| `npm run refresh-demo` | make the sample waiting queue "current" again |
| `npm run smoke-test` | with the API running, tests ~45 API workflows end to end |
| `npm run test-db` / `npm run demo` | original connection test / interactive scheduler demo |

### 1.6 Troubleshooting
| Symptom | Fix |
|---|---|
| `Access denied for user 'root'` | wrong `DB_PASSWORD` in `backend/.env` |
| `ECONNREFUSED` / cannot connect | MySQL service not running (Windows: *Services -> MySQL84 -> Start*) or wrong `DB_PORT` |
| Login page says "Cannot reach the server" | backend is not running (`npm start` in `backend/`) |
| `Port 5000 already in use` | change `PORT` in `.env` **and** `VITE_PROXY_TARGET` (see `frontend/.env.example`) |
| Want to start from scratch | `npm run setup-db:reset` in `backend/` |
| Setup is slow | normal for the first run: 437k history rows. Use `npm run setup-db:no-ml` if you do not need forecasts |

---

## 2. How it works (architecture)

```
Browser (React, :5173) --/api--> Vite proxy --> Express API (:5000) --> MySQL hospital_surge_db
```
* The browser stores only a signed login token. Every API call sends `Authorization: Bearer <token>`.
* The backend checks the token and the **role** (and hospital) on each route. Staff and doctors can only touch their own hospital.
* Operating-system-style scheduling (FCFS, SJF, Priority + aging + starvation detection, Round Robin), critical-section locking (a mutex around resource allocation), a producer/consumer buffer and a resource-waiting queue (the project's OS-concepts layer) are used by the real dispatcher; their results are stored in `scheduling_runs`, `scheduling_results`, `queue_entries`, `system_events` and `resource_history`.

### Typical flows
* **Patient emergency**: Patient -> Find Hospital -> Emergency -> *Go Now* -> `POST /api/portal/emergency` -> a patient row (named via `patient_profiles`), an `emergency_cases` row (`NEW`, priority from triage), a `queue_entries` row and `case_resource_requirements` (ICU / ventilator / oxygen / bed) are created.
* **Doctor/staff starts the case**: *Start* -> `startCase()` allocates the needed resources inside the critical section (inventory decreases, `resource_allocations` row, history + event). If something is missing, everything taken is rolled back and the case moves to **Awaiting Resources** (`RESOURCE_WAITING` queue).
* **Complete / Cancel** -> `completeCase()` releases all allocations, closes queue entries, and re-queues cases that were waiting for resources.
* **Dispatch next** (Staff -> Scheduling): ages priorities (+1 per 5 minutes waiting), logs starvation warnings, picks the best case and starts it.
* **Appointments**: Patient picks hospital + doctor + date + slot -> `POST /api/portal/appointments` (future date, doctor belongs to hospital, no double booking of a doctor slot).
* **Forecast**: for each 30-minute slot of the day, the average of the last 28 days of history (`emergency_cases`, including the ML patch) gives expected arrivals and critical arrivals for the next 6 hours, compared with free ICU beds/ventilators -> LOW / MEDIUM / HIGH surge risk. **This is a transparent statistical baseline (seasonal average), not a trained machine-learning model.**

### Status vocabulary (UI label <- database value)
Cases: Queued `NEW`, Ready `Ready`, Awaiting Resources `Waiting`, In Treatment `Running`, Completed, Cancelled.
Appointments: Booked, Confirmed, In Progress, Completed, Cancelled.

---

## 3. What I found and fixed

| # | Problem found in the supplied files | Fix |
|---|---|---|
| 1 | `appointments.patient_id` was `INT` but `patients.patient_id` is `BIGINT` -> migration failed with a foreign-key error | changed to `BIGINT` (`database/03_appointments.sql`, `backend/migrations/001_...`) |
| 2 | The seed gives every hospital only **one random resource row** (e.g. hospital 1 had only ICU beds, hospital 2 only general beds) and only 6 staff rows -> allocation, scheduling and appointment booking failed for almost every hospital | `database/05_complete_demo_data.sql` adds the missing ICU / general beds / ventilators / oxygen / blood rows and a doctor + nurse for all 299 hospitals (never changes existing rows) |
| 3 | Frontend used `localStorage` demo data; backend had no login, no patient names, no prescriptions, no doctor selection for booking | New auth, `app_users`, `patient_profiles`, `user_health_profiles`, `prescriptions` tables and the `/api/portal` adapter; every React page rewired |
| 4 | `GET /api/cases` returned **all 437,000** cases (and sorted priority ascending although 5 = highest) | filters + `limit` (default 100, max 1000) and `priority DESC` |
| 5 | `POST /api/scheduling/run` crashed with *Bind parameters must not contain undefined* when aging/starvation limits were omitted | values default correctly and are stored only for PRIORITY runs |
| 6 | `arrival_time_units` used different time bases (seed: minutes since 2026-10-01, new cases: minutes since midnight today) so aging/starvation were wrong | one shared clock (`simClock.js`, minutes since 2026-10-01 like the seed/patch) |
| 7 | Sample waiting cases were 3 weeks old, so aging would instantly give every case top priority | `scripts/refreshDemo.js` re-times only the old `NEW` sample cases to the last 1-25 minutes |
| 8 | Doctor "Running" status changed the state without allocating resources; no way to start a specific case | `startCase()` in `dispatcher.js`, used by `PUT /cases/:id/status`, `POST /cases/:id/start`, doctor routes and the UI Start button |
| 9 | Duplicated/unsafe code: unauthenticated routes, a test route, `completeCase` result rules | all domain routes now require login + role; hospital scoping for staff/doctors; test route removed |
| 10 | The ML patch's last `SELECT` returns hundreds of thousands of rows (can freeze Workbench) | limited to 96 preview rows (comment inside the file) |
| 11 | `FRONTEND_INTEGRATION.md` mentioned an `api.js` that was not in the zip | written (`frontend/src/api.js`) |

Things intentionally **not** changed: the original table design, scheduling algorithms and the OS-concept modules.

### Known limitations (honest notes)
* Distances/ETAs are **not** shown: the database has no coordinates. "Nearby" means *same district*; *Directions* opens Google Maps for the hospital name.
* The forecast is a seasonal-average baseline, not a trained ML model (the training patch is used as its history).
* The scheduler's time unit is "minutes" and burst times are simulation values, not clinical measurements. This is a coursework simulation, not a clinical decision system.
* Hospitals from the dataset cannot be deleted (they own history); only hospitals added from the Admin screen can be removed.
* Demo passwords are weak on purpose - change `AUTH_SECRET` and the passwords before exposing the app on a network.

---

## 4. Project structure and what every file does

```
mednexus/
  README.md                 this file
  setup.bat / start.bat     Windows helpers (install + DB setup / start both servers)
  database/                 SQL scripts, run in order by `npm run setup-db`
  backend/                  Express API
  frontend/                 React app
```

### 4.1 `database/`
| File | Purpose |
|---|---|
| `01_schema_and_seed.sql` | **Your original** `hospital_surge_db.sql`: creates 12 tables (`hospitals`, `patients`, `medical_staff`, `emergency_cases`, `resource_inventory`, `case_resource_requirements`, `resource_allocations`, `queue_entries`, `scheduling_runs`, `scheduling_results`, `resource_history`, `system_events`) and synthetic sample data. Drops/recreates tables. |
| `02_ml_training_patch.sql` | **Your original** ML patch (one tiny change: last SELECT limited). Creates ~437,000 synthetic historical patients/cases (6-28 Oct 2026, 30-minute slots, every hospital). Used by the forecast. |
| `03_appointments.sql` | Appointments table (fixed `BIGINT` foreign key). |
| `04_app_tables.sql` | New: `app_users` (login, role, hospital, linked staff row), `patient_profiles` (names, since `patients` has none), `user_health_profiles` (age, phone, blood group, allergies), `prescriptions`. |
| `05_complete_demo_data.sql` | New: fills missing resources/doctors/nurses for every hospital, adds indexes for history queries. Safe to re-run. |

### 4.2 `backend/` (Node.js / Express)
Entry and infrastructure
| File | Purpose / main functions |
|---|---|
| `server.js` | Creates the Express app, CORS, JSON, `/api/health` (also checks the DB), mounts every route group behind the right login/role guard, 404 + error handlers, prints a friendly MySQL error. |
| `db.js` | MySQL connection pool (`mysql2/promise`) configured from `.env`. |
| `auth.js` | `hashPassword` / `verifyPassword` (scrypt + salt), `signToken` / `verifyToken` (HMAC-SHA256 signed token, 12 h), `requireAuth(roles)` middleware, `canActOnHospital` (staff/doctor limited to own hospital). No extra libraries needed. |
| `simClock.js` | `nowUnits()`: current simulation minute (since 2026-10-01) shared by case creation and the dispatcher. |
| `caseService.js` | `createPatient`, `patientForUser` (one patient row per user per hospital), `createEmergencyCase` (case + queue entry + resource requirements + event in one transaction), `NEED_REQUIREMENTS` (UI need -> ICU/ventilator/oxygen/bed rows), `PRIORITY` map. |
| `.env.example` | Template for DB credentials, `PORT`, `AUTH_SECRET`. Copy to `.env`. |

Operating-system layer (your original algorithms)
| File | Purpose |
|---|---|
| `fcfs.js`, `sjf.js`, `priority.js`, `roundRobin.js` | The four scheduling algorithms; each takes processes (cases) and returns the completed order with start/finish/waiting/turnaround/response times. `priority.js` also applies aging and flags starvation. |
| `aging.js` | `applyAging()` raises priority of waiting cases (+1 per `waitingLimit` minutes, max 5). |
| `starvation.js` | `detectStarvation()` lists cases that waited too long. |
| `process.js` | `createProcess()` validates a process record. |
| `queue.js`, `producerConsumer.js`, `resourceWaiting.js` | In-memory ready queue, bounded producer/consumer buffer, and resource-waiting list (their durable copy is `queue_entries`). |
| `synchronization.js`, `criticalSection.js` | A promise-based mutex (`accessResource`) and `criticalSection()` wrapper so only one allocation changes inventory at a time. |
| `databaseCases.js` | `getHospitalCases()` (NEW/Ready cases as processes) and `getHospitalResources()`. |
| `resourceManager.js` | `allocateResource()` / `releaseResource()`: transactional, row-locked (`FOR UPDATE`) inventory changes with history and events. |
| `schedulerService.js` | `runScheduling()`: loads cases, runs the chosen algorithm, stores the run and results in `scheduling_runs` / `scheduling_results`. |
| `dispatcher.js` | `dispatchNext()` (aging, starvation, pick, allocate), **new** `startCase()` (start one case), `completeCase()` (release resources, re-queue waiting cases). Shared helper `startCaseResources()`. |
| `demo.js`, `test-db.js` | Original command-line demo/compare tool and connection test. |

Routes (`backend/routes/`)
| File | Endpoints |
|---|---|
| `authRoutes.js` | `POST /api/auth/register`, `/login`, `/guest`, `GET /me` |
| `portalRoutes.js` | **Frontend adapter**: hospitals with resource tuples, hospital records (cases + appointments in one list), patient `/me`, profile, emergency, appointment booking/cancel, staff walk-in, status changes, prescriptions, resource editing, report summary/export |
| `adminRoutes.js` | Users CRUD, add/remove hospital, dashboard overview (14-day trend, counts, uptime) |
| `forecastRoutes.js` | `GET /api/forecast/hospitals/:id?hours=6` seasonal-average forecast + surge risk |
| `caseRoutes.js` | list/register cases, `PUT /:id/status`, `POST /:id/start` |
| `schedulingRoutes.js` | `POST /run` (simulate algorithm), `POST /next` (dispatch) |
| `resourceRoutes.js`, `hospitalRoutes.js`, `patientRoutes.js`, `doctorRoutes.js`, `staffRoutes.js`, `appointmentRoutes.js` | Original REST routes (inventory/allocation, admin summaries, patient registration, doctor/staff queues, appointments) - kept and now protected by login/roles |

Scripts (`backend/scripts/`)
| File | Purpose |
|---|---|
| `setupDb.js` | One-command DB creation: reads `database/*.sql` (understands `DELIMITER`), skips destructive steps when data exists unless `--reset`. |
| `seedUsers.js` | Creates demo accounts and links doctors/staff to `medical_staff` rows. |
| `refreshDemo.js` | Re-times old sample `NEW` cases to "just now". |
| `smokeTest.js` | 45 end-to-end API checks (auth, roles, emergency -> start -> complete -> resources released, appointments, walk-ins, prescriptions, scheduling, forecast, admin). |

### 4.3 `frontend/` (React + Vite)
| File | Purpose |
|---|---|
| `vite.config.js` | Dev server on 5173 and proxy of `/api` to the backend (no CORS setup needed). |
| `src/main.jsx`, `src/App.jsx` | App bootstrap, routes `/`, `/patient`, `/staff`, `/doctor`, `/admin`, route guard by role. |
| `src/api.js` | `fetch` wrapper: adds the token, turns API errors into readable messages, logs out on expired session. |
| `src/store.jsx` | App state: session (login/register/guest/logout, restored on refresh), hospitals, records, patient data, polling every 15 s, `act()` helper (run a change -> toast -> refresh). |
| `src/data.js` | Constants and pure helpers: status labels, queue ordering (emergency first, severity, arrival), time-slot list, alerts, hospital status. |
| `src/ui.jsx` | Shared components: tags, tables, donut, hospital picker, status select, queue table, resource editor, report page, forecast card, layout + toast. |
| `src/pages/Login.jsx` | Login / patient register / emergency login. |
| `src/pages/Patient.jsx` | Dashboard, find hospital (emergency "Go Now" or book doctor appointment), profile, appointments, history + prescriptions, emergency status, notifications. |
| `src/pages/Staff.jsx` | Dashboard + forecast, emergency queue, patient management (walk-ins), resources editor, scheduling (run FCFS/SJF/Priority/RR, dispatch next), reports. |
| `src/pages/Doctor.jsx` | Dashboard, patient records, queue with Start/Done (allocates/releases resources), prescriptions, reports. |
| `src/pages/Admin.jsx` | System dashboard with real 14-day trend chart, hospitals (add/remove), users (create/delete), resources, settings, reports. |
| `src/index.css` | Styling (original plus toast/error classes). |
| `.env.example` | Optional `VITE_API_URL`, `VITE_PROXY_TARGET`. |

---

## 5. API quick reference
All routes except `/api/health` and `/api/auth/*` need `Authorization: Bearer <token>` (get it from `/api/auth/login`).
Run `npm run smoke-test` to see every workflow exercised against your running API.

## 6. Verification performed
Built and tested on MySQL 8.4 with the real dataset (299 hospitals, ~438,000 cases): database setup from empty (and re-run), 45/45 API smoke checks, production build of the frontend, and manual UI checks of staff, patient and admin screens.
