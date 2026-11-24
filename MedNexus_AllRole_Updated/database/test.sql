use hospital_surge_db;
show tables;

SELECT * FROM hospitals;

SELECT hospital_id, staff_code, staff_name, role, available_count
FROM medical_staff
ORDER BY hospital_id, role;

USE hospital_surge_db;

SELECT COUNT(*) AS total_cases
FROM emergency_cases;

SELECT COUNT(*) AS generated_cases
FROM emergency_cases
WHERE arrival_time >= '2026-10-06'
  AND arrival_time < '2026-10-29';

  SELECT hospital_id, COUNT(*) AS total_cases
FROM emergency_cases
WHERE arrival_time >= '2026-10-06'
  AND arrival_time < '2026-10-29'
GROUP BY hospital_id
ORDER BY hospital_id;

USE hospital_surge_db;

SELECT DATE(arrival_time) AS case_date,
       COUNT(*) AS total_cases,
       SUM(triage_level = 'Critical') AS critical_cases
FROM emergency_cases
WHERE arrival_time >= '2026-10-06'
  AND arrival_time < '2026-10-29'
GROUP BY DATE(arrival_time)
ORDER BY case_date;

SELECT
    COUNT(*) AS total_intervals,
    AVG(case_count) AS avg_cases_per_interval,
    MIN(case_count) AS min_cases_per_interval,
    MAX(case_count) AS max_cases_per_interval
FROM (
    SELECT
        hospital_id,
        DATE(arrival_time) AS case_date,
        HOUR(arrival_time) AS hour_of_day,
        FLOOR(MINUTE(arrival_time) / 30) AS half_hour_slot,
        COUNT(*) AS case_count
    FROM emergency_cases
    WHERE arrival_time >= '2026-10-06'
      AND arrival_time < '2026-10-29'
    GROUP BY hospital_id, case_date, hour_of_day, half_hour_slot
) AS interval_counts;

SHOW TABLES;

USE hospital_surge_db;
SELECT * FROM app_users;

SELECT * FROM resource_inventory;

SELECT * FROM emergency_cases;

SELECT * FROM patient_profiles;


use hospital_surge_db;
SELECT *
FROM emergency_cases
ORDER BY arrival_time DESC
LIMIT 20;

USE hospital_surge_db;

SELECT
    case_id,
    hospital_id,
    case_type,
    triage_level,
    priority,
    arrival_time_units,
    burst_time,
    remaining_time,
    process_state
FROM emergency_cases
ORDER BY case_id DESC
LIMIT 15;

SELECT
    hospital_id,
    process_state,
    COUNT(*) AS total_cases
FROM emergency_cases
GROUP BY hospital_id, process_state
ORDER BY hospital_id, process_state;

SELECT
    hospital_id,
    process_state,
    COUNT(*) AS total_cases
FROM emergency_cases
WHERE hospital_id = 399
GROUP BY hospital_id, process_state;

SELECT
    hospital_id,
    case_id,
    case_type,
    triage_level,
    priority,
    burst_time,
    process_state
FROM emergency_cases
WHERE hospital_id = 399
ORDER BY case_id DESC
LIMIT 20;