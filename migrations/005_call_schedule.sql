-- Real date/time for intro call scheduling (admin picks slot on dashboard)
-- Run after 004_outreach_files.sql.

ALTER TABLE applications
  ADD COLUMN call_scheduled_at DATETIME NULL AFTER call_schedule_attempts;