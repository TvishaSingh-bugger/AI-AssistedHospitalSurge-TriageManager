-- ===== ADDITIVE SCRIPT: 04_app_tables.sql =====
-- MedNexus integration tables (additive; safe to re-run).
-- Adds login accounts, patient display profiles, health profiles and prescriptions
-- so the React frontend can work against the real MySQL database.
USE hospital_surge_db;

CREATE TABLE IF NOT EXISTS app_users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(120) NOT NULL,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('patient','staff','doctor','admin') NOT NULL,
  hospital_id   INT NULL,
  staff_id      INT NULL,
  is_guest      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_app_users_email (email),
  CONSTRAINT fk_app_users_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals(hospital_id),
  CONSTRAINT fk_app_users_staff    FOREIGN KEY (staff_id)    REFERENCES medical_staff(staff_id)
);

-- One row per patient record that has a human name (the original schema stores no names).
CREATE TABLE IF NOT EXISTS patient_profiles (
  patient_id BIGINT PRIMARY KEY,
  user_id    INT NULL,
  full_name  VARCHAR(120) NOT NULL,
  KEY idx_patient_profiles_user (user_id),
  CONSTRAINT fk_profiles_patient FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
  CONSTRAINT fk_profiles_user    FOREIGN KEY (user_id)    REFERENCES app_users(user_id)
);

CREATE TABLE IF NOT EXISTS user_health_profiles (
  user_id            INT PRIMARY KEY,
  age                TINYINT UNSIGNED NULL,
  sex                ENUM('Female','Male','Other','Prefer not to say') NULL,
  phone              VARCHAR(30) NULL,
  blood_group        VARCHAR(5) NULL,
  allergies          VARCHAR(255) NULL,
  chronic_conditions VARCHAR(255) NULL,
  CONSTRAINT fk_health_user FOREIGN KEY (user_id) REFERENCES app_users(user_id)
);

CREATE TABLE IF NOT EXISTS prescriptions (
  prescription_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  hospital_id     INT NOT NULL,
  patient_id      BIGINT NOT NULL,
  doctor_user_id  INT NULL,
  doctor_name     VARCHAR(120) NOT NULL,
  medicine        VARCHAR(200) NOT NULL,
  notes           VARCHAR(500) NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rx_hospital (hospital_id, created_at),
  KEY idx_rx_patient (patient_id),
  CONSTRAINT fk_rx_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals(hospital_id),
  CONSTRAINT fk_rx_patient  FOREIGN KEY (patient_id)  REFERENCES patients(patient_id)
);
