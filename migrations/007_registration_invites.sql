-- Pending Levyni Co registration invites (link emailed with invoice).
-- Run after 006_logo_and_levyni_co.sql.

CREATE TABLE IF NOT EXISTS registration_invites (
    id              CHAR(36) PRIMARY KEY,
    application_id  CHAR(36) NOT NULL,
    email           VARCHAR(255) NOT NULL,
    token           VARCHAR(64) NOT NULL,
    username        VARCHAR(255) NOT NULL,
    temp_password   VARCHAR(255) NOT NULL,
    expires_at      DATETIME NOT NULL,
    used_at         DATETIME NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_registration_invites_token (token),
    KEY idx_registration_invites_email (email),
    KEY idx_registration_invites_app (application_id),
    KEY idx_registration_invites_pending (email, used_at, expires_at),

    CONSTRAINT fk_registration_invites_app
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
