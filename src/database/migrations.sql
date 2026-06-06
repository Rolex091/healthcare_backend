-- ============================================================
--  HEALTH CARE+ — Upgrade Migrations Schema
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW();

-- 1. Create doctor_patient_chats
CREATE TABLE IF NOT EXISTS doctor_patient_chats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create chat_participants
CREATE TABLE IF NOT EXISTS chat_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID REFERENCES doctor_patient_chats(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, user_id)
);

-- 3. Alter chat_messages to support doctor-patient chat (with backward compatibility)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES doctor_patient_chats(id) ON DELETE CASCADE;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false;

-- 4. Create chat_messages_files
CREATE TABLE IF NOT EXISTS chat_messages_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(100) NOT NULL,
  file_size INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Create medical_reports
CREATE TABLE IF NOT EXISTS medical_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID REFERENCES users(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Create medical_metrics
CREATE TABLE IF NOT EXISTS medical_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID REFERENCES medical_reports(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES users(id) ON DELETE CASCADE,
  heart_rate NUMERIC,
  blood_pressure_systolic NUMERIC,
  blood_pressure_diastolic NUMERIC,
  blood_sugar NUMERIC,
  weight NUMERIC,
  height NUMERIC,
  bmi NUMERIC,
  oxygen_level NUMERIC,
  cholesterol NUMERIC,
  hemoglobin NUMERIC,
  temperature NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Create ai_report_analysis
CREATE TABLE IF NOT EXISTS ai_report_analysis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID REFERENCES medical_reports(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES users(id) ON DELETE CASCADE,
  improved_metrics TEXT,
  worsened_metrics TEXT,
  normal_metrics TEXT,
  health_summary TEXT,
  lifestyle_recommendations TEXT,
  doctor_consultation_needed BOOLEAN DEFAULT false,
  raw_analysis_response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Create report_history
CREATE TABLE IF NOT EXISTS report_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID REFERENCES users(id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL, -- e.g., 'upload', 'delete', 'analysis_generated', 'booking_confirmed'
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Create chat_read_status
CREATE TABLE IF NOT EXISTS chat_read_status (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID REFERENCES doctor_patient_chats(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, user_id)
);

-- 10. Create appointment_reminders
CREATE TABLE IF NOT EXISTS appointment_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES users(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES users(id) ON DELETE CASCADE,
  reminded_at TIMESTAMPTZ,
  reminder_type VARCHAR(20), -- e.g., '15_min_before', '30_min_before'
  email_sent BOOLEAN DEFAULT false,
  sms_sent BOOLEAN DEFAULT false,
  in_app_sent BOOLEAN DEFAULT false,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Create storage buckets (insert metadata records for Supabase Storage compatibility)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('chat-files', 'chat-files', true, 52428800, NULL),
  ('medical-reports', 'medical-reports', true, 52428800, NULL),
  ('prescriptions', 'prescriptions', true, 52428800, NULL)
ON CONFLICT (id) DO NOTHING;

-- Enable Realtime on key tables
alter publication supabase_realtime add table chat_messages;
alter publication supabase_realtime add table chat_read_status;
alter publication supabase_realtime add table doctor_patient_chats;

\echo 'HEALTH CARE+ Migrations applied successfully!'
