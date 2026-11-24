-- ===== ADDITIVE SCRIPT: 05_complete_demo_data.sql =====
-- Fills gaps in the supplied seed data so every hospital is usable end to end.
-- The supplied seed gives each hospital only ONE random resource row and only
-- 6 staff rows (hospitals 1-3), so scheduling/allocation/booking failed for most
-- hospitals. This script ADDS what is missing and never changes existing rows.
-- Safe to re-run. Values are synthetic demo capacities derived from total_beds.
USE hospital_surge_db;

-- This demo build uses only Doctors and Nurses; remove prior Technician demo rows.
DELETE FROM medical_staff WHERE role = 'Technician';

INSERT INTO resource_inventory (hospital_id, resource_type, blood_group, total_quantity, available_quantity, unit)
SELECT h.hospital_id, t.rtype, t.bg,
       GREATEST(t.minimum, FLOOR(COALESCE(h.total_beds, 20) * t.ratio)) AS total_q,
       FLOOR(GREATEST(t.minimum, FLOOR(COALESCE(h.total_beds, 20) * t.ratio)) * (0.5 + MOD(h.hospital_id, 4) * 0.1)) AS avail_q,
       t.unit
FROM hospitals h
JOIN (
  SELECT 'ICU_BED' AS rtype, NULL AS bg, 0.10 AS ratio, 2 AS minimum, 'beds' AS unit
  UNION ALL SELECT 'GENERAL_BED',     NULL, 0.80, 5, 'beds'
  UNION ALL SELECT 'VENTILATOR',      NULL, 0.05, 1, 'units'
  UNION ALL SELECT 'OXYGEN_CYLINDER', NULL, 0.25, 4, 'cylinders'
  UNION ALL SELECT 'BLOOD_UNIT',      'O+', 0.10, 5, 'units'
) t
WHERE NOT EXISTS (
  SELECT 1 FROM resource_inventory ri
  WHERE ri.hospital_id = h.hospital_id
    AND ri.resource_type = t.rtype
    AND (t.rtype <> 'BLOOD_UNIT' OR ri.blood_group <=> t.bg)
);

INSERT INTO medical_staff (hospital_id, staff_code, staff_name, role, available_count)
SELECT h.hospital_id, CONCAT('AUTO-DOC-', h.hospital_id), CONCAT('Duty Doctor ', h.hospital_id), 'Doctor', 1
FROM hospitals h
WHERE NOT EXISTS (SELECT 1 FROM medical_staff s WHERE s.hospital_id = h.hospital_id AND s.role = 'Doctor');

INSERT INTO medical_staff (hospital_id, staff_code, staff_name, role, available_count)
SELECT h.hospital_id, CONCAT('AUTO-NUR-', h.hospital_id), CONCAT('Duty Nurse ', h.hospital_id), 'Nurse', 2
FROM hospitals h
WHERE NOT EXISTS (SELECT 1 FROM medical_staff s WHERE s.hospital_id = h.hospital_id AND s.role = 'Nurse');

-- Helpful indexes for the forecasting / dashboard history queries (hundreds of thousands of rows).
SET @has_idx := (SELECT COUNT(*) FROM information_schema.statistics
                 WHERE table_schema = DATABASE() AND table_name = 'emergency_cases'
                   AND index_name = 'idx_cases_hospital_arrival');
SET @ddl := IF(@has_idx = 0,
  'CREATE INDEX idx_cases_hospital_arrival ON emergency_cases (hospital_id, arrival_time)',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.statistics
                 WHERE table_schema = DATABASE() AND table_name = 'emergency_cases'
                   AND index_name = 'idx_cases_arrival');
SET @ddl := IF(@has_idx = 0,
  'CREATE INDEX idx_cases_arrival ON emergency_cases (arrival_time)',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
