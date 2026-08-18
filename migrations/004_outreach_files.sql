-- Outreach tracking + per-applicant file storage (invoice PDF, call audio)
-- Run after 001–003.

ALTER TABLE applications
  ADD COLUMN invoice_sent_at DATETIME NULL AFTER reviewed_at,
  ADD COLUMN pitch_sent_at DATETIME NULL AFTER invoice_sent_at,
  ADD COLUMN call_schedule_attempts INT NOT NULL DEFAULT 0 AFTER pitch_sent_at,
  ADD COLUMN invoice_file_path VARCHAR(500) NULL AFTER call_schedule_attempts,
  ADD COLUMN call_audio_path VARCHAR(500) NULL AFTER invoice_file_path,
  ADD COLUMN call_transcript TEXT NULL AFTER call_audio_path;
