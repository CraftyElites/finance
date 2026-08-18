-- Assessment question bank — lets admins manage quiz questions instead of
-- them being hardcoded into assessment.html.

CREATE TABLE IF NOT EXISTS assessment_questions (
    id             CHAR(36) PRIMARY KEY,
    question       TEXT NOT NULL,
    options        JSON NOT NULL,        -- array of answer choice strings, e.g. ["A","B","C","D"]
    correct_index  INT NOT NULL,         -- index into `options` that is correct
    sort_order     INT NOT NULL DEFAULT 0,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed the original five readiness questions so the assessment isn't empty
-- the first time this migration runs. Guarded so it only fires once, ever
-- (skipped as soon as any row exists — including ones you've since edited
-- or deleted through the admin dashboard).
INSERT INTO assessment_questions (id, question, options, correct_index, sort_order)
SELECT UUID(), 'What is gross margin?',
       JSON_ARRAY('Revenue minus all expenses', 'Revenue minus cost of goods sold, as % of revenue', 'Total assets minus liabilities', 'Monthly profit'),
       1, 1
WHERE NOT EXISTS (SELECT 1 FROM assessment_questions);

INSERT INTO assessment_questions (id, question, options, correct_index, sort_order)
SELECT UUID(), "What does 'runway' mean for a startup?",
       JSON_ARRAY('How long until product launch', 'How long current cash lasts before running out', 'The length of your sales cycle', 'Distance to your first investor'),
       1, 2
WHERE NOT EXISTS (SELECT 1 FROM assessment_questions WHERE question = "What does 'runway' mean for a startup?");

INSERT INTO assessment_questions (id, question, options, correct_index, sort_order)
SELECT UUID(), 'What is a cap table?',
       JSON_ARRAY('A table of company expenses', 'A record of who owns what equity in the company', 'A pricing menu for your product', 'A schedule of investor meetings'),
       1, 3
WHERE NOT EXISTS (SELECT 1 FROM assessment_questions WHERE question = 'What is a cap table?');

INSERT INTO assessment_questions (id, question, options, correct_index, sort_order)
SELECT UUID(), "What best describes 'CAC'?",
       JSON_ARRAY('Cost to acquire one customer', 'Cash available for the company', 'Compound annual conversion', 'Corporate audit checklist'),
       0, 4
WHERE NOT EXISTS (SELECT 1 FROM assessment_questions WHERE question = "What best describes 'CAC'?");

INSERT INTO assessment_questions (id, question, options, correct_index, sort_order)
SELECT UUID(), 'What is a SAFE note?',
       JSON_ARRAY('A type of business insurance', 'An agreement for future equity, not a loan', 'A government startup grant', 'A bank savings account for founders'),
       1, 5
WHERE NOT EXISTS (SELECT 1 FROM assessment_questions WHERE question = 'What is a SAFE note?');