-- ============================================================
--  HEALTH CARE+ — PostgreSQL Database Schema
--  Run: psql -U postgres -d healthcare_plus -f schema.sql
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fuzzy search on specialization

-- ─── Drop tables in reverse dependency order (safe re-run) ─────────────────
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS reminders CASCADE;
DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS available_slots CASCADE;
DROP TABLE IF EXISTS otp_verifications CASCADE;
DROP TABLE IF EXISTS doctor_profiles CASCADE;
DROP TABLE IF EXISTS patient_profiles CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ─── users ──────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  phone         VARCHAR(20),
  password_hash TEXT NOT NULL,
  role          VARCHAR(10) NOT NULL CHECK (role IN ('patient','doctor')),
  is_active     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role  ON users(role);

-- ─── patient_profiles ───────────────────────────────────────────────────────
CREATE TABLE patient_profiles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL DEFAULT '',
  age             INTEGER CHECK (age > 0 AND age < 150),
  gender          VARCHAR(20),
  blood_group     VARCHAR(10),
  medical_history TEXT,
  mobile          VARCHAR(20),
  email           VARCHAR(255),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_patient_profiles_user ON patient_profiles(user_id);

-- ─── doctor_profiles ────────────────────────────────────────────────────────
CREATE TABLE doctor_profiles (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name                    VARCHAR(255) NOT NULL DEFAULT '',
  specialization          VARCHAR(100),
  degree_certificate_url  TEXT,
  experience_years        INTEGER CHECK (experience_years >= 0),
  bio                     TEXT,
  phone                   VARCHAR(20),
  email                   VARCHAR(255),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_doctor_profiles_user           ON doctor_profiles(user_id);
CREATE INDEX idx_doctor_profiles_specialization ON doctor_profiles USING gin(specialization gin_trgm_ops);

-- ─── available_slots ────────────────────────────────────────────────────────
CREATE TABLE available_slots (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  doctor_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  time         TIME NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doctor_id, date, time)          -- prevents duplicate slot creation
);
CREATE INDEX idx_available_slots_doctor ON available_slots(doctor_id);
CREATE INDEX idx_available_slots_date   ON available_slots(date);

-- ─── appointments ───────────────────────────────────────────────────────────
CREATE TABLE appointments (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_id                 UUID REFERENCES available_slots(id),
  date                    DATE NOT NULL,
  time                    TIME NOT NULL,
  status                  VARCHAR(20) NOT NULL DEFAULT 'booked'
                            CHECK (status IN ('booked','completed','cancelled')),
  -- Snapshot of patient details at booking time
  patient_name            VARCHAR(255),
  patient_age             INTEGER,
  patient_gender          VARCHAR(20),
  patient_blood_group     VARCHAR(10),
  patient_medical_history TEXT,
  patient_mobile          VARCHAR(20),
  patient_email           VARCHAR(255),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_appointments_patient   ON appointments(patient_id);
CREATE INDEX idx_appointments_doctor    ON appointments(doctor_id);
CREATE INDEX idx_appointments_date      ON appointments(date);
CREATE INDEX idx_appointments_status    ON appointments(status);

-- ─── chat_messages ──────────────────────────────────────────────────────────
CREATE TABLE chat_messages (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id      VARCHAR(50) NOT NULL,   -- user UUID or 'ai'
  message        TEXT NOT NULL,
  is_ai_response BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_chat_messages_user ON chat_messages(user_id);
CREATE INDEX idx_chat_messages_time ON chat_messages(created_at);

-- ─── reminders ──────────────────────────────────────────────────────────────
CREATE TABLE reminders (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  appointment_id    UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sent','failed')),
  reminder_sent_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reminders_scheduled ON reminders(scheduled_at) WHERE status = 'pending';

-- ─── otp_verifications ──────────────────────────────────────────────────────
CREATE TABLE otp_verifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_code    VARCHAR(10) NOT NULL,
  contact     VARCHAR(255) NOT NULL,   -- email or phone
  expiry_time TIMESTAMPTZ NOT NULL,
  verified    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_otp_user    ON otp_verifications(user_id);
CREATE INDEX idx_otp_expiry  ON otp_verifications(expiry_time);

-- ─── Triggers: auto-update updated_at ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_patient_profiles_updated
  BEFORE UPDATE ON patient_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_doctor_profiles_updated
  BEFORE UPDATE ON doctor_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_appointments_updated
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Done ────────────────────────────────────────────────────────────────────
\echo '✅ HEALTH CARE+ schema created successfully!'
