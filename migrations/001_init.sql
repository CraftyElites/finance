-- Levyni Connect — core schema (MySQL / MariaDB)

-- Admin users who can log into the dashboard
CREATE TABLE IF NOT EXISTS admin_users (
    id            CHAR(36) PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Founder applications submitted through the public onboarding form
CREATE TABLE IF NOT EXISTS applications (
    id                  CHAR(36) PRIMARY KEY,

    -- Applicant identity
    full_name           VARCHAR(255) NOT NULL,
    email               VARCHAR(255) NOT NULL,
    phone               VARCHAR(50),

    -- Tier chosen on the landing page
    tier                VARCHAR(50) NOT NULL,        -- Starter | Growth | Scale | Premium
    tier_amount         INT NOT NULL,                 -- naira amount, e.g. 5000

    -- Business profile (from onboarding form)
    business_name       VARCHAR(255),
    industry            VARCHAR(100),
    cac_registered      BOOLEAN,
    stage               VARCHAR(100),
    monthly_revenue     VARCHAR(100),
    team_size           VARCHAR(50),
    years_operating     VARCHAR(50),
    traction_notes      TEXT,
    amount_seeking      VARCHAR(100),
    use_of_funds        TEXT,

    -- Workflow status
    -- pending            -> just submitted, awaiting admin review
    -- accepted           -> admin accepted; assessment invite sent
    -- assessment_started -> applicant opened the assessment link
    -- assessment_done    -> applicant submitted the quiz
    -- rejected           -> admin rejected
    status              VARCHAR(30) NOT NULL DEFAULT 'pending',

    admin_note          TEXT,
    reviewed_by         CHAR(36),
    reviewed_at         DATETIME,

    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_applications_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES admin_users(id),
    KEY idx_applications_status (status),
    KEY idx_applications_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One-time assessment access tokens, issued when an admin accepts an application
CREATE TABLE IF NOT EXISTS assessment_tokens (
    id             CHAR(36) PRIMARY KEY,
    application_id CHAR(36) NOT NULL,
    token          VARCHAR(255) NOT NULL UNIQUE,
    expires_at     DATETIME NOT NULL,
    used_at        DATETIME,               -- set once the quiz is submitted; token is then dead
    revoked        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_tokens_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
    KEY idx_assessment_tokens_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Quiz submissions
CREATE TABLE IF NOT EXISTS assessment_results (
    id             CHAR(36) PRIMARY KEY,
    application_id CHAR(36) NOT NULL,
    token_id       CHAR(36) NOT NULL,
    answers        JSON NOT NULL,          -- raw answers array
    score          INT NOT NULL,
    total          INT NOT NULL,
    submitted_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_results_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
    CONSTRAINT fk_results_token FOREIGN KEY (token_id) REFERENCES assessment_tokens(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;