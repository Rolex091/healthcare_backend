-- ============================================================
--  HEALTH CARE+ — Seed Data
--  Run AFTER schema.sql:
--  psql -U postgres -d healthcare_plus -f seed.sql
-- ============================================================

-- Passwords are all: Test@1234 (bcrypt hash)
-- $2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhN3WLHY.Zu1CgZ6cHjMSm

-- ─── Doctors (pre-activated accounts) ───────────────────────────────────────
INSERT INTO users (id, email, phone, password_hash, role, is_active) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'dr.priya@healthcareplus.com',    '9876500001', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhN3WLHY.Zu1CgZ6cHjMSm', 'doctor', true),
  ('d1000000-0000-0000-0000-000000000002', 'dr.kumar@healthcareplus.com',    '9876500002', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhN3WLHY.Zu1CgZ6cHjMSm', 'doctor', true),
  ('d1000000-0000-0000-0000-000000000003', 'dr.meena@healthcareplus.com',    '9876500003', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhN3WLHY.Zu1CgZ6cHjMSm', 'doctor', true),
  ('d1000000-0000-0000-0000-000000000004', 'dr.rajan@healthcareplus.com',    '9876500004', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhN3WLHY.Zu1CgZ6cHjMSm', 'doctor', true),
  ('d1000000-0000-0000-0000-000000000005', 'dr.lakshmi@healthcareplus.com',  '9876500005', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhN3WLHY.Zu1CgZ6cHjMSm', 'doctor', true);

INSERT INTO doctor_profiles (user_id, name, specialization, experience_years, bio, phone, email) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'Dr. Priya Sharma',    'General Medicine',  12, 'Experienced general physician specializing in preventive care.', '9876500001', 'dr.priya@healthcareplus.com'),
  ('d1000000-0000-0000-0000-000000000002', 'Dr. Arun Kumar',      'Dermatologist',      8, 'Specialist in skin disorders, acne treatment, and cosmetic dermatology.', '9876500002', 'dr.kumar@healthcareplus.com'),
  ('d1000000-0000-0000-0000-000000000003', 'Dr. Meena Sundaram',  'Psychologist',      10, 'Clinical psychologist focused on anxiety, depression, and cognitive therapy.', '9876500003', 'dr.meena@healthcareplus.com'),
  ('d1000000-0000-0000-0000-000000000004', 'Dr. Rajesh Rajan',    'Cardiologist',      15, 'Senior cardiologist with expertise in heart disease prevention.', '9876500004', 'dr.rajan@healthcareplus.com'),
  ('d1000000-0000-0000-0000-000000000005', 'Dr. Lakshmi Devi',    'Pediatrician',       9, 'Caring pediatrician with focus on child wellness and development.', '9876500005', 'dr.lakshmi@healthcareplus.com');

-- ─── Patients ────────────────────────────────────────────────────────────────
INSERT INTO users (id, email, phone, password_hash, role, is_active) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'patient.arjun@gmail.com',   '9876600001', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhN3WLHY.Zu1CgZ6cHjMSm', 'patient', true),
  ('a2000000-0000-0000-0000-000000000002', 'patient.anita@gmail.com',   '9876600002', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhN3WLHY.Zu1CgZ6cHjMSm', 'patient', true),
  ('a2000000-0000-0000-0000-000000000003', 'patient.vikram@gmail.com',  '9876600003', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhN3WLHY.Zu1CgZ6cHjMSm', 'patient', true);

INSERT INTO patient_profiles (user_id, name, age, gender, blood_group, medical_history, mobile, email) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'Arjun Selvam',   28, 'Male',   'O+',  'Mild hypertension, controlled with diet', '9876600001', 'patient.arjun@gmail.com'),
  ('a2000000-0000-0000-0000-000000000002', 'Anita Krishnan', 35, 'Female', 'B+',  'No significant history', '9876600002', 'patient.anita@gmail.com'),
  ('a2000000-0000-0000-0000-000000000003', 'Vikram Nair',    42, 'Male',   'AB-', 'Type 2 Diabetes, managed with metformin', '9876600003', 'patient.vikram@gmail.com');

-- ─── Available Slots (next 7 days) ───────────────────────────────────────────
INSERT INTO available_slots (doctor_id, date, time) VALUES
  -- Dr. Priya (General Medicine)
  ('d1000000-0000-0000-0000-000000000001', CURRENT_DATE + 1, '09:00'),
  ('d1000000-0000-0000-0000-000000000001', CURRENT_DATE + 1, '10:00'),
  ('d1000000-0000-0000-0000-000000000001', CURRENT_DATE + 1, '11:00'),
  ('d1000000-0000-0000-0000-000000000001', CURRENT_DATE + 2, '09:00'),
  ('d1000000-0000-0000-0000-000000000001', CURRENT_DATE + 2, '14:00'),
  -- Dr. Arun (Dermatologist)
  ('d1000000-0000-0000-0000-000000000002', CURRENT_DATE + 1, '10:00'),
  ('d1000000-0000-0000-0000-000000000002', CURRENT_DATE + 1, '15:00'),
  ('d1000000-0000-0000-0000-000000000002', CURRENT_DATE + 3, '09:00'),
  -- Dr. Meena (Psychologist)
  ('d1000000-0000-0000-0000-000000000003', CURRENT_DATE + 1, '11:00'),
  ('d1000000-0000-0000-0000-000000000003', CURRENT_DATE + 2, '16:00'),
  -- Dr. Rajan (Cardiologist)
  ('d1000000-0000-0000-0000-000000000004', CURRENT_DATE + 2, '10:00'),
  ('d1000000-0000-0000-0000-000000000004', CURRENT_DATE + 2, '11:00'),
  ('d1000000-0000-0000-0000-000000000004', CURRENT_DATE + 4, '09:00'),
  -- Dr. Lakshmi (Pediatrician)
  ('d1000000-0000-0000-0000-000000000005', CURRENT_DATE + 1, '09:00'),
  ('d1000000-0000-0000-0000-000000000005', CURRENT_DATE + 3, '10:00');

\echo '✅ Seed data inserted successfully!'
\echo '   Test credentials (all roles): password = Test@1234'
\echo '   Doctor logins: dr.priya@healthcareplus.com, dr.kumar@healthcareplus.com, etc.'
\echo '   Patient logins: patient.arjun@gmail.com, patient.anita@gmail.com, etc.'
