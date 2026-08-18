-- Levyni Connect — tiers (admin-managed), cohort settings, and the extra
-- applicant fields needed for the WhatsApp-first application flow.

-- Founder tiers shown on the landing page's "Pick Your Tier" section.
-- This is the single source of truth for tier data — the landing page
-- fetches from GET /api/tiers instead of having tiers hardcoded in HTML.
CREATE TABLE IF NOT EXISTS tiers (
    id           CHAR(36) PRIMARY KEY,
    name         VARCHAR(100) NOT NULL UNIQUE,
    amount       INT NOT NULL,                  -- linking fee charged at application (naira)
    slot_fee     INT NOT NULL DEFAULT 0,         -- fee mentioned in the follow-up slot email
    features     JSON NOT NULL,
    recommended  BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order   INT NOT NULL DEFAULT 0,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed the tiers that used to be hardcoded on the landing page, so the
-- admin dashboard and public site aren't empty on first run. Guarded so it
-- only fires once (skipped as soon as any tier row exists).
INSERT INTO tiers (id, name, amount, slot_fee, features, recommended, sort_order)
SELECT UUID(), 'Starter', 5000, 15000,
       JSON_ARRAY('Full onboarding', 'VA interview', 'Quiz + scoring'),
       FALSE, 1
WHERE NOT EXISTS (SELECT 1 FROM tiers);

INSERT INTO tiers (id, name, amount, slot_fee, features, recommended, sort_order)
SELECT UUID(), 'Growth', 10000, 25000,
       JSON_ARRAY('All Starter + priority', 'Faster VA slot'),
       TRUE, 2
WHERE NOT EXISTS (SELECT 1 FROM tiers WHERE name = 'Growth');

INSERT INTO tiers (id, name, amount, slot_fee, features, recommended, sort_order)
SELECT UUID(), 'Scale', 20000, 35000,
       JSON_ARRAY('Extended VA', 'Feedback report'),
       FALSE, 3
WHERE NOT EXISTS (SELECT 1 FROM tiers WHERE name = 'Scale');

INSERT INTO tiers (id, name, amount, slot_fee, features, recommended, sort_order)
SELECT UUID(), 'Premium', 50000, 50000,
       JSON_ARRAY('1:1 pitch review', 'Strategy session'),
       FALSE, 4
WHERE NOT EXISTS (SELECT 1 FROM tiers WHERE name = 'Premium');

-- Single-row settings table an admin controls from the dashboard: which
-- cohort is currently open, how many applications it caps at (default
-- 1,000, changeable), and the WhatsApp group applicants get redirected to
-- right after they submit an application.
CREATE TABLE IF NOT EXISTS settings (
    id                 TINYINT PRIMARY KEY DEFAULT 1,
    cohort_name        VARCHAR(100) NOT NULL DEFAULT 'Cohort 1',
    max_applications   INT NOT NULL DEFAULT 1000,
    whatsapp_group_url VARCHAR(500),
    updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO settings (id, cohort_name, max_applications, whatsapp_group_url)
SELECT 1, 'Cohort 1', 1000, NULL
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1);

-- Applicants now provide a second, required phone number (their WhatsApp
-- number, since after applying they're redirected into a WhatsApp group)
-- and each application is stamped with the cohort it was submitted under,
-- so the 1,000-per-cohort cap can be enforced and reset per cohort.
ALTER TABLE applications ADD COLUMN whatsapp_phone VARCHAR(50) AFTER phone;
ALTER TABLE applications ADD COLUMN cohort_name VARCHAR(100) AFTER tier_amount;

-- Backfill any pre-existing rows into the default cohort so the cap query
-- (COUNT(*) WHERE cohort_name = ?) has something sane to count against.
UPDATE applications SET cohort_name = 'Cohort 1' WHERE cohort_name IS NULL;

CREATE INDEX idx_applications_cohort ON applications (cohort_name);