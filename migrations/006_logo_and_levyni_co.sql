-- Company logo on applications + Levyni Co account provisioning state
-- Run after 005_call_scheduled_at.sql.

ALTER TABLE applications
  ADD COLUMN logo_path VARCHAR(500) NULL AFTER call_transcript,
  ADD COLUMN levyni_co_user_id VARCHAR(100) NULL AFTER logo_path,
  ADD COLUMN levyni_co_created_at DATETIME NULL AFTER levyni_co_user_id;
