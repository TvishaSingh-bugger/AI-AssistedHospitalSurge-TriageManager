-- ===== OPTIONAL SYNTHETIC ML TRAINING DATA (02_ml_training_patch.sql) =====
-- This section creates synthetic historical emergency cases for forecasting, not live data.
-- Synthetic ML forecasting data patch compatible with the updated hospital_surge_db.
-- Adds synthetic historical patients and emergency cases only.
-- Does NOT drop tables, alter hospital records, or modify total_beds (including NULL values).
-- Dynamically processes every hospital_id currently present; no fixed 1..50 assumption.
-- MySQL 8.x. Data dates: 2026-10-06 through 2026-10-28 inclusive, 30-minute slots.
-- Synthetic training/demo records only; not real clinical data.

USE hospital_surge_db;

DROP PROCEDURE IF EXISTS add_ml_training_cases;
DELIMITER $$

CREATE PROCEDURE add_ml_training_cases()
BEGIN
    DECLARE v_done INT DEFAULT 0;
    DECLARE v_hospital_id INT;
    DECLARE v_day_offset INT DEFAULT 0;
    DECLARE v_slot INT DEFAULT 0;
    DECLARE v_n INT DEFAULT 0;
    DECLARE v_case_count INT DEFAULT 0;
    DECLARE v_hour INT DEFAULT 0;
    DECLARE v_arrival DATETIME;
    DECLARE v_patient_id BIGINT;
    DECLARE v_age INT;
    DECLARE v_sex VARCHAR(20);
    DECLARE v_triage VARCHAR(20);
    DECLARE v_priority INT;
    DECLARE v_case_type VARCHAR(100);
    DECLARE v_burst INT;
    DECLARE v_case_code VARCHAR(30);
    DECLARE v_patient_code VARCHAR(30);

    DECLARE hospital_cursor CURSOR FOR
        SELECT hospital_id FROM hospitals ORDER BY hospital_id;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

    OPEN hospital_cursor;

    hospital_loop: LOOP
        FETCH hospital_cursor INTO v_hospital_id;
        IF v_done = 1 THEN
            LEAVE hospital_loop;
        END IF;

        SET v_day_offset = 0;
        WHILE v_day_offset <= 22 DO
            SET v_slot = 0;

            -- 48 half-hour slots per day.
            WHILE v_slot < 48 DO
                SET v_hour = FLOOR(v_slot / 2);
                SET v_case_count = 1;

                -- Quiet overnight; higher volume during morning/evening peaks.
                IF v_hour BETWEEN 0 AND 4 THEN
                    SET v_case_count = IF(MOD(v_hospital_id + v_day_offset + v_slot, 3) = 0, 0, 1);
                ELSEIF v_hour BETWEEN 7 AND 10 OR v_hour BETWEEN 17 AND 21 THEN
                    SET v_case_count = 2;
                END IF;

                -- Occasional small bursts and quieter off-peak slots.
                IF MOD(v_hospital_id * 7 + v_day_offset * 5 + v_slot * 3, 17) = 0 THEN
                    SET v_case_count = v_case_count + 1;
                ELSEIF v_hour NOT BETWEEN 7 AND 10
                   AND v_hour NOT BETWEEN 17 AND 21
                   AND MOD(v_hospital_id + v_day_offset * 2 + v_slot, 13) = 0 THEN
                    SET v_case_count = 0;
                END IF;

                SET v_n = 1;
                WHILE v_n <= v_case_count DO
                    SET v_arrival = TIMESTAMP('2026-10-06 00:00:00')
                        + INTERVAL v_day_offset DAY
                        + INTERVAL (v_slot * 30) MINUTE
                        + INTERVAL MOD(v_hospital_id * 7 + v_day_offset * 3 + v_slot * 11 + v_n * 13, 24) MINUTE;

                    SET v_patient_code = CONCAT(
                        'MLP-', LPAD(v_hospital_id, 5, '0'), '-',
                        DATE_FORMAT(v_arrival, '%m%d'), '-',
                        LPAD(v_slot * 4 + v_n, 3, '0')
                    );
                    SET v_case_code = CONCAT(
                        'MLC-', LPAD(v_hospital_id, 5, '0'), '-',
                        DATE_FORMAT(v_arrival, '%m%d'), '-',
                        LPAD(v_slot * 4 + v_n, 3, '0')
                    );

                    -- Make the patch safe to rerun: skip a case code already present.
                    IF NOT EXISTS (
                        SELECT 1 FROM emergency_cases
                        WHERE hospital_id = v_hospital_id AND case_code = v_case_code
                    ) THEN
                        SET v_age = 18 + MOD(v_hospital_id * 3 + v_day_offset * 7 + v_slot * 2 + v_n, 73);
                        SET v_sex = CASE MOD(v_hospital_id + v_day_offset + v_slot + v_n, 3)
                            WHEN 0 THEN 'Female'
                            WHEN 1 THEN 'Male'
                            ELSE 'Other'
                        END;

                        -- Severity mix: mostly Medium, with Low/High and occasional Critical.
                        SET v_triage = CASE MOD(v_hospital_id * 5 + v_day_offset * 3 + v_slot + v_n, 20)
                            WHEN 0 THEN 'Critical'
                            WHEN 1 THEN 'Critical'
                            WHEN 2 THEN 'High'
                            WHEN 3 THEN 'High'
                            WHEN 4 THEN 'High'
                            WHEN 5 THEN 'Low'
                            WHEN 6 THEN 'Low'
                            WHEN 7 THEN 'Low'
                            WHEN 8 THEN 'Low'
                            ELSE 'Medium'
                        END;

                        SET v_priority = CASE v_triage
                            WHEN 'Critical' THEN 5
                            WHEN 'High' THEN 4
                            WHEN 'Medium' THEN 3
                            ELSE 1
                        END;

                        SET v_case_type = CASE MOD(v_hospital_id + v_day_offset + v_slot + v_n, 8)
                            WHEN 0 THEN 'Respiratory distress'
                            WHEN 1 THEN 'Chest pain'
                            WHEN 2 THEN 'Road traffic injury'
                            WHEN 3 THEN 'Fever and acute illness'
                            WHEN 4 THEN 'Breathing difficulty'
                            WHEN 5 THEN 'Abdominal pain'
                            WHEN 6 THEN 'Fracture assessment'
                            ELSE 'Severe dehydration'
                        END;

                        SET v_burst = 3 + MOD(v_hospital_id + v_day_offset * 2 + v_slot + v_n, 18);

                        INSERT INTO patients
                            (hospital_id, patient_code, age, sex, registered_at, is_synthetic)
                        VALUES
                            (v_hospital_id, v_patient_code, v_age, v_sex, v_arrival, TRUE);

                        SET v_patient_id = LAST_INSERT_ID();

                        INSERT INTO emergency_cases
                            (hospital_id, patient_id, case_code, case_type, triage_level, priority,
                             arrival_time, arrival_time_units, burst_time, remaining_time,
                             process_state, notes)
                        VALUES
                            (v_hospital_id, v_patient_id, v_case_code, v_case_type, v_triage, v_priority,
                             v_arrival,
                             TIMESTAMPDIFF(MINUTE, '2026-10-01 00:00:00', v_arrival),
                             v_burst, 0, 'Completed',
                             'SYNTHETIC ML forecasting training record; not a real patient');
                    END IF;

                    SET v_n = v_n + 1;
                END WHILE;

                SET v_slot = v_slot + 1;
            END WHILE;

            SET v_day_offset = v_day_offset + 1;
        END WHILE;
    END LOOP;

    CLOSE hospital_cursor;
END$$

DELIMITER ;

START TRANSACTION;
CALL add_ml_training_cases();
DROP PROCEDURE IF EXISTS add_ml_training_cases;
COMMIT;

-- Verification: case counts per hospital, including synthetic records in this date range.
SELECT h.hospital_id, h.hospital_name, h.total_beds,
       COUNT(c.case_id) AS total_cases,
       SUM(c.arrival_time >= '2026-10-06 00:00:00'
           AND c.arrival_time < '2026-10-29 00:00:00') AS synthetic_cases_in_patch_window,
       SUM(c.triage_level = 'Critical'
           AND c.arrival_time >= '2026-10-06 00:00:00'
           AND c.arrival_time < '2026-10-29 00:00:00') AS critical_cases_in_patch_window
FROM hospitals h
LEFT JOIN emergency_cases c ON c.hospital_id = h.hospital_id
GROUP BY h.hospital_id, h.hospital_name, h.total_beds
ORDER BY h.hospital_id;

-- Verify case counts in each 30-minute interval (MedNexus: limited to the first 96 rows;
-- the unlimited result has hundreds of thousands of rows).
SELECT hospital_id,
       DATE(arrival_time) AS case_date,
       HOUR(arrival_time) AS hour_of_day,
       FLOOR(MINUTE(arrival_time) / 30) AS half_hour_slot,
       COUNT(*) AS emergency_cases,
       SUM(triage_level = 'Critical') AS critical_cases
FROM emergency_cases
WHERE arrival_time >= '2026-10-06 00:00:00'
  AND arrival_time <  '2026-10-29 00:00:00'
GROUP BY hospital_id, DATE(arrival_time), HOUR(arrival_time), FLOOR(MINUTE(arrival_time) / 30)
ORDER BY hospital_id, case_date, hour_of_day, half_hour_slot
LIMIT 96;
