-- Additive migration for the existing hospital_surge_db database.
-- Does not drop or recreate any existing tables.
USE hospital_surge_db;

CREATE TABLE IF NOT EXISTS appointments (
    appointment_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    patient_id BIGINT NOT NULL,
    hospital_id INT NOT NULL,
    doctor_id INT NOT NULL,
    appointment_date DATETIME NOT NULL,
    reason VARCHAR(500) NULL,
    appointment_status ENUM(
        'Booked', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'
    ) NOT NULL DEFAULT 'Booked',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_appointment_patient
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
    CONSTRAINT fk_appointment_hospital
        FOREIGN KEY (hospital_id) REFERENCES hospitals(hospital_id),
    CONSTRAINT fk_appointment_doctor
        FOREIGN KEY (doctor_id) REFERENCES medical_staff(staff_id),
    INDEX idx_appointments_patient_date (patient_id, appointment_date),
    INDEX idx_appointments_doctor_date (doctor_id, appointment_date),
    INDEX idx_appointments_hospital_date (hospital_id, appointment_date)
);
