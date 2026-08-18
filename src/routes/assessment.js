const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { sendFollowUpEmail } = require('../utils/email');

function parseOptions(options) {
  return typeof options === 'string' ? JSON.parse(options) : options;
}

// GET /api/assessment/:token — validate the link and return applicant context + the live question bank
router.get('/:token', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT t.id as token_id, t.expires_at, t.used_at, t.revoked,
              a.id as application_id, a.full_name, a.tier
       FROM assessment_tokens t
       JOIN applications a ON a.id = t.application_id
       WHERE t.token = ?`,
      [req.params.token]
    );

    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Invalid link' });
    if (row.revoked) return res.status(410).json({ error: 'This link has been revoked. Ask Levyni for a new one.' });
    if (row.used_at) return res.status(410).json({ error: 'This link has already been used.' });
    if (new Date(row.expires_at) < new Date()) return res.status(410).json({ error: 'This link has expired. Ask Levyni for a new one.' });

    // Mark as started (first open), non-destructive
    await db.query(
      `UPDATE applications SET status = 'assessment_started', updated_at = NOW()
       WHERE id = ? AND status = 'accepted'`,
      [row.application_id]
    );

    // Pull the live question bank — managed from the admin dashboard.
    // Correct answers are never sent to the client.
    const { rows: questionRows } = await db.query(
      `SELECT id, question, options FROM assessment_questions ORDER BY sort_order ASC, created_at ASC`
    );
    const questions = questionRows.map((q) => ({
      id: q.id,
      question: q.question,
      options: parseOptions(q.options),
    }));

    res.json({
      fullName: row.full_name,
      tier: row.tier,
      expiresAt: row.expires_at,
      questions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not validate link' });
  }
});

// POST /api/assessment/:token/submit — { answers: [{ questionId, selectedIndex }] }
// Score is computed server-side against the current question bank so an admin
// editing a question after the fact, or a tampered client payload, can't skew it.
// After this, the token is marked used and can never be opened again.
router.post('/:token/submit', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { answers } = req.body;
    if (!Array.isArray(answers) || !answers.length) {
      return res.status(400).json({ error: 'answers[] is required' });
    }
    for (const a of answers) {
      if (!a || typeof a.questionId !== 'string') {
        return res.status(400).json({ error: 'Each answer needs a questionId' });
      }
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM assessment_tokens WHERE token = ? FOR UPDATE`,
      [req.params.token]
    );
    const tokenRow = rows[0];

    if (!tokenRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invalid link' });
    }
    if (tokenRow.revoked || tokenRow.used_at) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'This link is no longer valid.' });
    }
    if (new Date(tokenRow.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'This link has expired.' });
    }

    // Score against the current answer key.
    const questionIds = answers.map((a) => a.questionId);
    const placeholders = questionIds.map(() => '?').join(',');
    const { rows: questionRows } = await client.query(
      `SELECT id, correct_index FROM assessment_questions WHERE id IN (${placeholders})`,
      questionIds
    );
    const correctById = new Map(questionRows.map((q) => [q.id, q.correct_index]));

    let score = 0;
    answers.forEach((a) => {
      if (correctById.has(a.questionId) && correctById.get(a.questionId) === a.selectedIndex) {
        score++;
      }
    });
    const total = answers.length;

    const resultId = crypto.randomUUID();
    await client.query(
      `INSERT INTO assessment_results (id, application_id, token_id, answers, score, total)
       VALUES (?,?,?,?,?,?)`,
      [resultId, tokenRow.application_id, tokenRow.id, JSON.stringify(answers), score, total]
    );

    // Kill the token — one-time use, "delete" it functionally
    await client.query(
      `UPDATE assessment_tokens SET used_at = NOW() WHERE id = ?`,
      [tokenRow.id]
    );

    await client.query(
      `UPDATE applications SET status = 'assessment_done', updated_at = NOW() WHERE id = ?`,
      [tokenRow.application_id]
    );

    // Completing the assessment — regardless of score — triggers an
    // immediate follow-up email with next steps, instead of an in-browser
    // booking page. The slot fee mentioned in that email comes from the
    // applicant's tier, looked up fresh rather than stored on the
    // application itself.
    const { rows: appRows } = await client.query(
      `SELECT full_name, email, tier FROM applications WHERE id = ?`,
      [tokenRow.application_id]
    );
    const applicant = appRows[0];
    const { rows: tierRows } = await client.query(
      `SELECT slot_fee FROM tiers WHERE name = ?`,
      [applicant.tier]
    );
    const slotFee = tierRows[0] ? tierRows[0].slot_fee : 0;

    await client.query('COMMIT');

    try {
      await sendFollowUpEmail({
        to: applicant.email,
        fullName: applicant.full_name,
        tier: applicant.tier,
        slotFee,
      });
    } catch (emailErr) {
      // Assessment is already recorded — don't fail the request over a
      // delivery issue, just log it so an admin can follow up manually.
      console.error('Follow-up email failed to send:', emailErr);
    }

    res.json({
      message: 'Assessment submitted. Check your email — we\'ll send your follow-up slot shortly.',
      score,
      total,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not submit assessment' });
  } finally {
    client.release();
  }
});

module.exports = router;