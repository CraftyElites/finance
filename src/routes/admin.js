const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const {
  sendAcceptanceEmail,
  sendRejectionEmail,
  sendInvoiceEmail,
  sendCallScheduleEmail,
  sendPitchEmail,
  sendLevyniCoCredentialsEmail,
} = require('../utils/email');
const { transcribeFile } = require('../utils/transcribe');
const { buildPitchPdf } = require('../utils/pitch-pdf');
const { normalizeTier } = require('./tiers');

// Per-applicant files: uploads/applications/{id}/invoice.* | call-audio.*
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'applications');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

function applicantDir(appId) {
  const dir = path.join(UPLOAD_ROOT, appId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, applicantDir(req.params.id)),
    filename: (req, file, cb) => {
      const kind = req.uploadKind || 'file';
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      cb(null, `${kind}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB — call audio
});

// ---------- Auth ----------

// POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const { rows } = await db.query(
      `SELECT id, name, email, password_hash FROM admin_users WHERE email = ?`,
      [email.trim().toLowerCase()]
    );
    const admin = rows[0];
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.name },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/admin/me
router.get('/me', requireAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

// All routes below require a valid admin token
router.use(requireAdmin);

// ---------- Applications list ----------

// GET /api/admin/applications?status=pending
router.get('/applications', async (req, res) => {
  try {
    const { status } = req.query;
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE status = ?`;
    }

    const { rows } = await db.query(
      `SELECT id, full_name, email, phone, tier, tier_amount, business_name, industry,
              stage, monthly_revenue, team_size, amount_seeking, status, admin_note,
              invoice_sent_at, pitch_sent_at, call_schedule_attempts, call_scheduled_at,
              invoice_file_path, call_audio_path, call_transcript, logo_path,
              levyni_co_user_id, levyni_co_created_at,
              created_at, reviewed_at
       FROM applications
       ${where}
       ORDER BY created_at DESC`,
      params
    );

    res.json({ applications: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch applications' });
  }
});

// GET /api/admin/applications/:id — full detail incl. any assessment result
router.get('/applications/:id', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM applications WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const { rows: results } = await db.query(
      `SELECT score, total, submitted_at FROM assessment_results WHERE application_id = ?
       ORDER BY submitted_at DESC LIMIT 1`,
      [req.params.id]
    );

    res.json({ application: rows[0], assessment: results[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch application' });
  }
});

// ---------- Accept: generate one-time token + email the applicant ----------

// POST /api/admin/applications/:id/accept
router.post('/applications/:id/accept', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM applications WHERE id = ? FOR UPDATE`,
      [req.params.id]
    );
    const application = rows[0];
    if (!application) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Application not found' });
    }
    if (application.status === 'accepted' || application.status === 'assessment_done') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Application already ${application.status}` });
    }

    // Generate a random one-time token for the assessment link
    const tokenId = crypto.randomUUID();
    const token = crypto.randomBytes(24).toString('hex');
    const ttlHours = Number(process.env.ASSESSMENT_LINK_TTL_HOURS || 72);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await client.query(
      `INSERT INTO assessment_tokens (id, application_id, token, expires_at)
       VALUES (?, ?, ?, ?)`,
      [tokenId, application.id, token, expiresAt]
    );

    await client.query(
      `UPDATE applications
       SET status = 'accepted', reviewed_by = ?, reviewed_at = NOW(),
           pitch_sent_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [req.admin.id, application.id]
    );

    await client.query('COMMIT');

    const assessmentUrl = `${process.env.APP_URL}/assessment.html?token=${token}`;

    // Pitch PDF + assessment in the same email
    let pitchPdf = null;
    try {
      pitchPdf = await buildPitchPdf(application);
    } catch (pdfErr) {
      console.error('Pitch PDF generation failed (continuing with assessment only):', pdfErr);
    }

    try {
      await sendAcceptanceEmail({
        to: application.email,
        fullName: application.full_name,
        tier: application.tier,
        assessmentUrl,
        expiresAt,
        pitchPdf,
      });
    } catch (emailErr) {
      console.error('Acceptance email failed to send:', emailErr);
      return res.status(202).json({
        message: 'Application accepted, but the email failed to send. Use resend.',
        assessmentUrl,
      });
    }

    res.json({
      message: pitchPdf
        ? 'Accepted — assessment link and pitch brief emailed together.'
        : 'Application accepted and assessment link emailed.',
      assessmentUrl,
      pitchAttached: !!pitchPdf,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not accept application' });
  } finally {
    client.release();
  }
});

// POST /api/admin/applications/:id/resend — re-issue a fresh token + resend email
router.post('/applications/:id/resend', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM applications WHERE id = ?`, [req.params.id]);
    const application = rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found' });

    // Revoke any previous unused tokens
    await db.query(
      `UPDATE assessment_tokens SET revoked = true
       WHERE application_id = ? AND used_at IS NULL`,
      [application.id]
    );

    const tokenId = crypto.randomUUID();
    const token = crypto.randomBytes(24).toString('hex');
    const ttlHours = Number(process.env.ASSESSMENT_LINK_TTL_HOURS || 72);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO assessment_tokens (id, application_id, token, expires_at) VALUES (?,?,?,?)`,
      [tokenId, application.id, token, expiresAt]
    );

    const assessmentUrl = `${process.env.APP_URL}/assessment.html?token=${token}`;
    let pitchPdf = null;
    try {
      pitchPdf = await buildPitchPdf(application);
    } catch (pdfErr) {
      console.error('Pitch PDF generation failed on resend:', pdfErr);
    }
    await sendAcceptanceEmail({
      to: application.email,
      fullName: application.full_name,
      tier: application.tier,
      assessmentUrl,
      expiresAt,
      pitchPdf,
    });
    if (pitchPdf) {
      await db.query(`UPDATE applications SET pitch_sent_at = NOW() WHERE id = ?`, [application.id]);
    }

    res.json({
      message: pitchPdf
        ? 'New assessment link + pitch brief emailed.'
        : 'New assessment link emailed.',
      assessmentUrl,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not resend invite' });
  }
});

// ---------- Reject ----------

// POST /api/admin/applications/:id/reject  { note?: string }
router.post('/applications/:id/reject', async (req, res) => {
  try {
    const { note } = req.body;

    const { rows: existing } = await db.query(`SELECT id FROM applications WHERE id = ?`, [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Application not found' });

    await db.query(
      `UPDATE applications
       SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [note || null, req.admin.id, req.params.id]
    );

    // MySQL has no UPDATE ... RETURNING — read the row back.
    const { rows } = await db.query(`SELECT * FROM applications WHERE id = ?`, [req.params.id]);
    const application = rows[0];

    try {
      await sendRejectionEmail({
        to: application.email,
        fullName: application.full_name,
        tier: application.tier,
        note,
      });
    } catch (emailErr) {
      console.error('Rejection email failed to send:', emailErr);
    }

    res.json({ message: 'Application rejected.', application });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reject application' });
  }
});

// ---------- Pre-accept outreach + files ----------
// Files live at uploads/applications/{id}/invoice.* and call-audio.*
// Migration: 004_outreach_files.sql

async function loadApplication(id) {
  const { rows } = await db.query(`SELECT * FROM applications WHERE id = ?`, [id]);
  return rows[0] || null;
}

function absUploadPath(rel) {
  if (!rel) return null;
  const fromRoot = path.join(__dirname, '..', '..', rel);
  return fs.existsSync(fromRoot) ? fromRoot : null;
}

// POST /api/admin/applications/:id/upload-invoice  (multipart field: file)
router.post('/applications/:id/upload-invoice', (req, res, next) => {
  req.uploadKind = 'invoice';
  next();
}, upload.single('file'), async (req, res) => {
  try {
    const application = await loadApplication(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const rel = path.join('uploads', 'applications', application.id, req.file.filename).replace(/\\/g, '/');
    await db.query(
      `UPDATE applications SET invoice_file_path = ?, updated_at = NOW() WHERE id = ?`,
      [rel, application.id]
    );
    res.json({ message: 'Invoice file uploaded.', invoice_file_path: rel });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not upload invoice file' });
  }
});

// POST /api/admin/applications/:id/upload-call-audio  (multipart field: file)
router.post('/applications/:id/upload-call-audio', (req, res, next) => {
  req.uploadKind = 'call-audio';
  next();
}, upload.single('file'), async (req, res) => {
  try {
    const application = await loadApplication(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const rel = path.join('uploads', 'applications', application.id, req.file.filename).replace(/\\/g, '/');
    await db.query(
      `UPDATE applications SET call_audio_path = ?, updated_at = NOW() WHERE id = ?`,
      [rel, application.id]
    );
    res.json({ message: 'Call audio uploaded.', call_audio_path: rel });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not upload call audio' });
  }
});

// POST /api/admin/applications/:id/transcribe
// In-process Splitline engine (sherpa-onnx). Optional body: { numSpeakers?: number }
router.post('/applications/:id/transcribe', async (req, res) => {
  try {
    const application = await loadApplication(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (!application.call_audio_path) {
      return res.status(400).json({ error: 'Upload call audio before transcribing' });
    }

    const audioAbs = absUploadPath(application.call_audio_path);
    if (!audioAbs) {
      return res.status(404).json({ error: 'Call audio file missing on disk' });
    }

    const numSpeakers = Number(req.body?.numSpeakers);
    const result = await transcribeFile(audioAbs, {
      numSpeakers: Number.isFinite(numSpeakers) && numSpeakers > 0 ? numSpeakers : undefined,
    });

    await db.query(
      `UPDATE applications SET call_transcript = ?, updated_at = NOW() WHERE id = ?`,
      [result.transcript || null, application.id]
    );

    res.json({
      message: result.transcript ? 'Transcription complete.' : 'No speech segments detected.',
      call_transcript: result.transcript,
      speakerCount: result.speakerCount,
      segments: result.segments,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not transcribe call audio' });
  }
});

/** Create or regenerate a single active registration invite per email. */
async function upsertRegistrationInvite(application) {
  const email = String(application.email).trim().toLowerCase();
  const username = String(application.business_name || application.full_name || 'founder')
    .trim()
    .slice(0, 80);
  const token = crypto.randomBytes(24).toString('hex');
  const tempPassword = crypto.randomBytes(12).toString('base64url');
  const ttlHours = Number(process.env.REGISTRATION_INVITE_TTL_HOURS || 72);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const id = crypto.randomUUID();

  // Invalidate any previous unused invites for this email (unique active invite)
  await db.query(
    `UPDATE registration_invites SET used_at = NOW()
     WHERE email = ? AND used_at IS NULL`,
    [email]
  );

  await db.query(
    `INSERT INTO registration_invites
      (id, application_id, email, token, username, temp_password, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, application.id, email, token, username, tempPassword, expiresAt]
  );

  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  const registerUrl = `${base}/register.html?token=${token}`;

  return { id, token, username, tempPassword, expiresAt, registerUrl };
}

// POST /api/admin/applications/:id/send-invoice
// Emails invoice PDF + Levyni Co account registration link (invite token).
router.post('/applications/:id/send-invoice', async (req, res) => {
  try {
    const application = await loadApplication(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (application.status === 'rejected') {
      return res.status(409).json({ error: 'Cannot invoice a rejected application' });
    }

    const invite = await upsertRegistrationInvite(application);
    const attachmentPath = absUploadPath(application.invoice_file_path);

    await sendInvoiceEmail({
      to: application.email,
      fullName: application.full_name,
      tier: application.tier,
      amount: application.tier_amount,
      businessName: application.business_name,
      attachmentPath,
      registerUrl: invite.registerUrl,
      expiresAt: invite.expiresAt,
    });

    await db.query(
      `UPDATE applications SET invoice_sent_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [application.id]
    );

    res.json({
      message: application.invoice_sent_at
        ? 'Invoice + registration link resent.'
        : 'Invoice + registration link sent.',
      invoice_sent_at: new Date().toISOString(),
      attached: !!attachmentPath,
      registerUrl: invite.registerUrl,
      inviteExpiresAt: invite.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not send invoice' });
  }
});

// POST /api/admin/applications/:id/regenerate-invite
// New link for the same email (old unused tokens invalidated).
router.post('/applications/:id/regenerate-invite', async (req, res) => {
  try {
    const application = await loadApplication(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (application.status === 'rejected') {
      return res.status(409).json({ error: 'Cannot invite a rejected application' });
    }

    const invite = await upsertRegistrationInvite(application);
    await sendInvoiceEmail({
      to: application.email,
      fullName: application.full_name,
      tier: application.tier,
      amount: application.tier_amount,
      businessName: application.business_name,
      attachmentPath: absUploadPath(application.invoice_file_path),
      registerUrl: invite.registerUrl,
      expiresAt: invite.expiresAt,
    });

    res.json({
      message: 'Registration link regenerated and emailed.',
      registerUrl: invite.registerUrl,
      inviteExpiresAt: invite.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not regenerate invite' });
  }
});

// GET /api/admin/registration-invites?pending=1 — list invites (filter unused)
router.get('/registration-invites', async (req, res) => {
  try {
    const pendingOnly = req.query.pending === '1' || req.query.pending === 'true';
    const { rows } = await db.query(
      pendingOnly
        ? `SELECT id, application_id, email, username, expires_at, used_at, created_at
           FROM registration_invites
           WHERE used_at IS NULL
           ORDER BY created_at DESC`
        : `SELECT id, application_id, email, username, expires_at, used_at, created_at
           FROM registration_invites
           ORDER BY created_at DESC
           LIMIT 200`
    );
    res.json({ invites: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list invites' });
  }
});

// DELETE /api/admin/registration-invites/:id — remove a pending invite
router.delete('/registration-invites/:id', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT id FROM registration_invites WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Invite not found' });
    await db.query(`DELETE FROM registration_invites WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Invite deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete invite' });
  }
});

// POST /api/admin/applications/:id/send-call-schedule
// Body: { scheduledAt: ISO string } — real date/time required
router.post('/applications/:id/send-call-schedule', async (req, res) => {
  try {
    const application = await loadApplication(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (application.status === 'rejected') {
      return res.status(409).json({ error: 'Cannot schedule a call for a rejected application' });
    }

    const attempts = Number(application.call_schedule_attempts || 0);
    if (attempts >= 5) {
      return res.status(409).json({ error: 'Call schedule limit reached (5/5)' });
    }

    const scheduledAt = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ error: 'scheduledAt is required (valid date/time)' });
    }

    await sendCallScheduleEmail({
      to: application.email,
      fullName: application.full_name,
      tier: application.tier,
      businessName: application.business_name,
      attempt: attempts + 1,
      scheduledAt,
    });

    await db.query(
      `UPDATE applications
       SET call_schedule_attempts = COALESCE(call_schedule_attempts, 0) + 1,
           call_scheduled_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [scheduledAt, application.id]
    );

    res.json({
      message: 'Call scheduled and email sent.',
      call_schedule_attempts: attempts + 1,
      call_scheduled_at: scheduledAt.toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not send call schedule' });
  }
});

// POST /api/admin/applications/:id/send-pitch — standalone resend of pitch PDF only
router.post('/applications/:id/send-pitch', async (req, res) => {
  try {
    const application = await loadApplication(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (application.status === 'rejected') {
      return res.status(409).json({ error: 'Cannot send pitch to a rejected application' });
    }

    const pdfBuffer = await buildPitchPdf(application);
    await sendPitchEmail({
      to: application.email,
      fullName: application.full_name,
      tier: application.tier,
      businessName: application.business_name,
      pdfBuffer,
    });

    await db.query(
      `UPDATE applications SET pitch_sent_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [application.id]
    );

    res.json({
      message: application.pitch_sent_at ? 'Pitch brief resent.' : 'Pitch brief sent.',
      pitch_sent_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not send pitch document' });
  }
});


// POST /api/admin/applications/:id/add-to-base
// Alias: issues a registration invite link (same as regenerate-invite).
// Account is created when the applicant opens the link (no OTP).
router.post('/applications/:id/add-to-base', async (req, res) => {
  try {
    const application = await loadApplication(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (application.levyni_co_user_id && application.levyni_co_user_id !== 'pending_otp') {
      return res.status(409).json({
        error: 'Company already registered on Levyni Co',
        levyni_co_user_id: application.levyni_co_user_id,
      });
    }
    if (application.status === 'rejected') {
      return res.status(409).json({ error: 'Cannot invite a rejected application' });
    }

    const invite = await upsertRegistrationInvite(application);
    await sendInvoiceEmail({
      to: application.email,
      fullName: application.full_name,
      tier: application.tier,
      amount: application.tier_amount,
      businessName: application.business_name,
      attachmentPath: absUploadPath(application.invoice_file_path),
      registerUrl: invite.registerUrl,
      expiresAt: invite.expiresAt,
    });

    res.json({
      message: 'Registration link emailed (with invoice if on file). Applicant creates account via the link.',
      registerUrl: invite.registerUrl,
      inviteExpiresAt: invite.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not send registration invite' });
  }
});

// ---------- Assessment question bank ----------
// These endpoints let an admin manage the quiz questions shown in
// assessment.html without touching code — the public assessment route
// reads from the same `assessment_questions` table.

function normalizeQuestion(row) {
  return {
    id: row.id,
    question: row.question,
    options: typeof row.options === 'string' ? JSON.parse(row.options) : row.options,
    correctIndex: row.correct_index,
    sortOrder: row.sort_order,
  };
}

// GET /api/admin/questions — full list, including correct answers, for the editor UI
router.get('/questions', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, question, options, correct_index, sort_order
       FROM assessment_questions
       ORDER BY sort_order ASC, created_at ASC`
    );
    res.json({ questions: rows.map(normalizeQuestion) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch questions' });
  }
});

// POST /api/admin/questions — { question, options: string[], correctIndex, sortOrder? }
router.post('/questions', async (req, res) => {
  try {
    const { question, options, correctIndex, sortOrder } = req.body;

    if (!question || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'question and at least 2 options are required' });
    }
    if (
      typeof correctIndex !== 'number' ||
      correctIndex < 0 ||
      correctIndex >= options.length
    ) {
      return res.status(400).json({ error: 'correctIndex must point at one of the options' });
    }

    const id = crypto.randomUUID();

    let order = sortOrder;
    if (typeof order !== 'number') {
      const { rows } = await db.query(`SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM assessment_questions`);
      order = (rows[0].maxOrder || 0) + 1;
    }

    await db.query(
      `INSERT INTO assessment_questions (id, question, options, correct_index, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [id, question.trim(), JSON.stringify(options), correctIndex, order]
    );

    const { rows } = await db.query(
      `SELECT id, question, options, correct_index, sort_order FROM assessment_questions WHERE id = ?`,
      [id]
    );
    res.status(201).json({ question: normalizeQuestion(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create question' });
  }
});

// PUT /api/admin/questions/:id — update any subset of { question, options, correctIndex, sortOrder }
router.put('/questions/:id', async (req, res) => {
  try {
    const { rows: existingRows } = await db.query(
      `SELECT id, question, options, correct_index, sort_order FROM assessment_questions WHERE id = ?`,
      [req.params.id]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Question not found' });

    const current = normalizeQuestion(existing);
    const question = req.body.question ?? current.question;
    const options = Array.isArray(req.body.options) ? req.body.options : current.options;
    const correctIndex = typeof req.body.correctIndex === 'number' ? req.body.correctIndex : current.correctIndex;
    const sortOrder = typeof req.body.sortOrder === 'number' ? req.body.sortOrder : current.sortOrder;

    if (!question || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'question and at least 2 options are required' });
    }
    if (correctIndex < 0 || correctIndex >= options.length) {
      return res.status(400).json({ error: 'correctIndex must point at one of the options' });
    }

    await db.query(
      `UPDATE assessment_questions
       SET question = ?, options = ?, correct_index = ?, sort_order = ?
       WHERE id = ?`,
      [question.trim(), JSON.stringify(options), correctIndex, sortOrder, req.params.id]
    );

    const { rows } = await db.query(
      `SELECT id, question, options, correct_index, sort_order FROM assessment_questions WHERE id = ?`,
      [req.params.id]
    );
    res.json({ question: normalizeQuestion(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update question' });
  }
});

// DELETE /api/admin/questions/:id
router.delete('/questions/:id', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT id FROM assessment_questions WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Question not found' });

    await db.query(`DELETE FROM assessment_questions WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Question deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete question' });
  }
});

// ---------- Tiers ----------
// Founder tiers shown on the landing page's "Pick Your Tier" section — managed
// here instead of being hardcoded in index.html. The public GET /api/tiers
// route (src/routes/tiers.js) reads from this same `tiers` table.

// GET /api/admin/tiers
router.get('/tiers', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, amount, slot_fee, features, recommended, sort_order
       FROM tiers ORDER BY sort_order ASC, created_at ASC`
    );
    res.json({ tiers: rows.map(normalizeTier) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch tiers' });
  }
});

// POST /api/admin/tiers — { name, amount, slotFee, features: string[], recommended?, sortOrder? }
router.post('/tiers', async (req, res) => {
  try {
    const { name, amount, slotFee, features, recommended, sortOrder } = req.body;

    if (!name || typeof amount !== 'number' || !Array.isArray(features) || !features.length) {
      return res.status(400).json({ error: 'name, amount, and at least 1 feature are required' });
    }

    const id = crypto.randomUUID();
    let order = sortOrder;
    if (typeof order !== 'number') {
      const { rows } = await db.query(`SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM tiers`);
      order = (rows[0].maxOrder || 0) + 1;
    }

    await db.query(
      `INSERT INTO tiers (id, name, amount, slot_fee, features, recommended, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), amount, typeof slotFee === 'number' ? slotFee : 0, JSON.stringify(features), !!recommended, order]
    );

    const { rows } = await db.query(
      `SELECT id, name, amount, slot_fee, features, recommended, sort_order FROM tiers WHERE id = ?`,
      [id]
    );
    res.status(201).json({ tier: normalizeTier(rows[0]) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A tier with that name already exists' });
    console.error(err);
    res.status(500).json({ error: 'Could not create tier' });
  }
});

// PUT /api/admin/tiers/:id — update any subset of { name, amount, slotFee, features, recommended, sortOrder }
router.put('/tiers/:id', async (req, res) => {
  try {
    const { rows: existingRows } = await db.query(
      `SELECT id, name, amount, slot_fee, features, recommended, sort_order FROM tiers WHERE id = ?`,
      [req.params.id]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Tier not found' });

    const current = normalizeTier(existing);
    const name = req.body.name ?? current.name;
    const amount = typeof req.body.amount === 'number' ? req.body.amount : current.amount;
    const slotFee = typeof req.body.slotFee === 'number' ? req.body.slotFee : current.slotFee;
    const features = Array.isArray(req.body.features) ? req.body.features : current.features;
    const recommended = typeof req.body.recommended === 'boolean' ? req.body.recommended : current.recommended;
    const sortOrder = typeof req.body.sortOrder === 'number' ? req.body.sortOrder : current.sortOrder;

    if (!name || !features.length) {
      return res.status(400).json({ error: 'name and at least 1 feature are required' });
    }

    await db.query(
      `UPDATE tiers SET name = ?, amount = ?, slot_fee = ?, features = ?, recommended = ?, sort_order = ?
       WHERE id = ?`,
      [name.trim(), amount, slotFee, JSON.stringify(features), recommended, sortOrder, req.params.id]
    );

    const { rows } = await db.query(
      `SELECT id, name, amount, slot_fee, features, recommended, sort_order FROM tiers WHERE id = ?`,
      [req.params.id]
    );
    res.json({ tier: normalizeTier(rows[0]) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A tier with that name already exists' });
    console.error(err);
    res.status(500).json({ error: 'Could not update tier' });
  }
});

// DELETE /api/admin/tiers/:id
router.delete('/tiers/:id', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT id FROM tiers WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Tier not found' });

    await db.query(`DELETE FROM tiers WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Tier deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete tier' });
  }
});

// ---------- Settings ----------
// Single-row config: which cohort is open, its application cap (defaults to
// 1,000, changeable here), and the WhatsApp group applicants are redirected
// to right after submitting an application.

function normalizeSettings(row) {
  return {
    cohortName: row.cohort_name,
    maxApplications: row.max_applications,
    whatsappGroupUrl: row.whatsapp_group_url,
  };
}

// GET /api/admin/settings
router.get('/settings', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT cohort_name, max_applications, whatsapp_group_url FROM settings WHERE id = 1`
    );
    if (!rows.length) return res.status(404).json({ error: 'Settings not found' });
    res.json({ settings: normalizeSettings(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch settings' });
  }
});

// PUT /api/admin/settings — { cohortName, maxApplications, whatsappGroupUrl }
router.put('/settings', async (req, res) => {
  try {
    const { cohortName, maxApplications, whatsappGroupUrl } = req.body;

    if (!cohortName || typeof maxApplications !== 'number' || maxApplications < 1) {
      return res.status(400).json({
        error: 'cohortName and a positive maxApplications are required',
      });
    }

    await db.query(
      `INSERT INTO settings (id, cohort_name, max_applications, whatsapp_group_url)
       VALUES (1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         cohort_name = VALUES(cohort_name),
         max_applications = VALUES(max_applications),
         whatsapp_group_url = VALUES(whatsapp_group_url)`,
      [cohortName.trim(), maxApplications, whatsappGroupUrl || null]
    );

    const { rows } = await db.query(
      `SELECT cohort_name, max_applications, whatsapp_group_url FROM settings WHERE id = 1`
    );
    res.json({ settings: normalizeSettings(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update settings' });
  }
});

module.exports = router;