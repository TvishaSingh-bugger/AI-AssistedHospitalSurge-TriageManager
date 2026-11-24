# MedNexus registration update

This full project copy adds registration for Staff and Doctors and a protected one-time Administrator setup. Existing Patient registration and login remain in place.

## Registration behavior
- Patient: existing `/api/auth/register` flow.
- Staff/Doctor: `/api/auth/register-role`; creates a `medical_staff` record and linked `app_users` account transactionally.
- Administrator: protected first-time `/api/auth/bootstrap-admin` route; only works when no administrator exists and the bootstrap key matches.

## Administrator setup
1. In `backend`, copy `.env.example` to `.env`.
2. Set your own database password and a strong `AUTH_SECRET`.
3. Add `ADMIN_BOOTSTRAP_KEY` with a random secret at least 16 characters long.
4. Start backend. In the login screen select Administrator -> First administrator setup. Enter the bootstrap key.
5. After the first admin is created, the bootstrap route refuses subsequent admin creation. Keep the key secret; rotate/remove it after setup.

## Install dependencies and run
- Backend: `cd backend`, `npm install`, `npm start`
- Frontend: `cd frontend`, `npm install`, `npm run dev`

Do not deploy open self-registration for staff/doctors in a production hospital without identity/approval controls. This project version allows self-registration as requested for demonstration/testing.
