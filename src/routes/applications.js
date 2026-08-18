const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const db = require('../db');

const LOGO_ROOT = path.join(__dirname, '..', '..', 'uploads', 'applications');
fs.mkdirSync(LOGO_ROOT, { recursive: true });

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpeg|jpg|webp|gif|svg\+xml)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Logo must be an image (png, jpg, webp, gif, svg)'), ok);
  },
});

async function getSettings() {
  const { rows } = await db.query(
    `SELECT cohort_name, max_applications, whatsapp_group_url FROM settings WHERE id = 1`
  );
  return rows[0] || { cohort_name: 'Cohort 1', max_applications: 1000, whatsapp_group_url: null };
}

// GET /api/applications/cohort-status — public, lets the landing/apply pages
// show "applications closed" once the current cohort hits its cap. The cap
// itself is admin-managed (PUT /api/admin/settings).
router.get('/cohort-status', async (req, res) => {
  try {
    const settings = await getSettings();
    const { rows } = await db.query(
      `SELECT COUNT(*) AS cnt FROM applications WHERE cohort_name = ?`,
      [settings.cohort_name]
    );
    const submitted = Number(rows[0].cnt);
    res.json({
      cohortName: settings.cohort_name,
      maxApplications: settings.max_applications,
      submitted,
      remaining: Math.max(settings.max_applications - submitted, 0),
      open: submitted < settings.max_applications,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch cohort status' });
  }
});

// POST /api/applications — submit the onboarding form (public, no auth).
// Optional multipart field "logo". JSON-only still works if no file is sent.
// Flow after this: applicant is redirected into the Levyni WhatsApp group
// (whatsappUrl below) to send their info; Levyni confirms and requests a
// payment receipt for their slot; once confirmed, an admin accepts the
// application from the dashboard, which emails a one-time assessment link.
router.post('/', logoUpload.single('logo'), async (req, res) => {
  try {
    const {
      fullName,
      email,
      phone,
      whatsappPhone,
      tier,
      businessName,
      industry,
      cacRegistered,
      stage,
      monthlyRevenue,
      teamSize,
      yearsOperating,
      tractionNotes,
      amountSeeking,
      useOfFunds,
    } = req.body;

    if (!fullName || !email || !phone || !whatsappPhone || !tier) {
      return res.status(400).json({
        error: 'fullName, email, phone, whatsappPhone and tier are required',
      });
    }

    const settings = await getSettings();

    // Enforce the per-cohort cap (default 1,000, admin-changeable).
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS cnt FROM applications WHERE cohort_name = ?`,
      [settings.cohort_name]
    );
    if (Number(countRows[0].cnt) >= settings.max_applications) {
      return res.status(409).json({
        error: `Applications for ${settings.cohort_name} are closed (cap of ${settings.max_applications} reached). Please check back for the next cohort.`,
      });
    }

    // Tiers are admin-managed (see /api/admin/tiers) — validate against the
    // live table instead of a hardcoded list so it can never drift out of
    // sync with what's shown on the landing page.
    const { rows: tierRows } = await db.query(
      `SELECT name, amount FROM tiers WHERE name = ?`,
      [tier]
    );
    if (!tierRows.length) {
      return res.status(400).json({ error: 'Invalid tier selected' });
    }
    const tierAmount = tierRows[0].amount;

    const id = crypto.randomUUID();

    let logoPath = null;
    if (req.file && req.file.buffer) {
      const ext = path.extname(req.file.originalname || '').toLowerCase() || '.png';
      const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext) ? ext : '.png';
      const dir = path.join(LOGO_ROOT, id);
      fs.mkdirSync(dir, { recursive: true });
      const filename = `logo${safeExt}`;
      fs.writeFileSync(path.join(dir, filename), req.file.buffer);
      logoPath = path.join('uploads', 'applications', id, filename).replace(/\\/g, '/');
    }

    await db.query(
      `INSERT INTO applications
        (id, full_name, email, phone, whatsapp_phone, tier, tier_amount, cohort_name,
         business_name, industry, cac_registered, stage, monthly_revenue, team_size,
         years_operating, traction_notes, amount_seeking, use_of_funds, logo_path)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        fullName.trim(),
        email.trim().toLowerCase(),
        phone.trim(),
        whatsappPhone.trim(),
        tier,
        tierAmount,
        settings.cohort_name,
        businessName || null,
        industry || null,
        cacRegistered === 'yes' ? true : cacRegistered === 'no' ? false : null,
        stage || null,
        monthlyRevenue || null,
        teamSize || null,
        yearsOperating || null,
        tractionNotes || null,
        amountSeeking || null,
        useOfFunds || null,
        logoPath,
      ]
    );

    // MySQL has no RETURNING clause — read the row back for the response.
    const { rows } = await db.query(
      `SELECT id, status, created_at FROM applications WHERE id = ?`,
      [id]
    );

    res.status(201).json({
      message:
        'Application submitted. Join our WhatsApp group and send your details there — once we confirm your payment receipt for your slot, we will accept you and email a one-time assessment link.',
      application: rows[0],
      whatsappUrl: settings.whatsapp_group_url || null,
    });
  } catch (err) {
    console.error('Failed to create application:', err);
    res.status(500).json({ error: 'Could not submit application' });
  }
});


// ---------- Registration invite redeem (public) ----------
// Link: /register.html?token=... → POST /api/applications/register/:token

router.get('/register/:token', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT i.id, i.email, i.username, i.expires_at, i.used_at, i.application_id,
              a.full_name, a.business_name, a.status AS application_status
       FROM registration_invites i
       JOIN applications a ON a.id = i.application_id
       WHERE i.token = ?`,
      [req.params.token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invalid registration link' });
    const inv = rows[0];
    if (inv.used_at) return res.status(410).json({ error: 'This link was already used' });
    if (new Date(inv.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This link has expired' });
    }
    if (inv.application_status === 'rejected') {
      return res.status(403).json({ error: 'Application is not eligible' });
    }
    res.json({
      email: inv.email,
      username: inv.username,
      fullName: inv.full_name,
      businessName: inv.business_name,
      expiresAt: inv.expires_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load invite' });
  }
});

router.post('/register/:token', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT i.*, a.status AS application_status, a.id AS app_id
       FROM registration_invites i
       JOIN applications a ON a.id = i.application_id
       WHERE i.token = ?`,
      [req.params.token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invalid registration link' });
    const inv = rows[0];
    if (inv.used_at) return res.status(410).json({ error: 'This link was already used' });
    if (new Date(inv.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This link has expired' });
    }
    if (inv.application_status === 'rejected') {
      return res.status(403).json({ error: 'Application is not eligible' });
    }

    const createUrl =
      process.env.LEVYNI_CO_ADMIN_CREATE_URL || 'https://levyni.com/api/auth/admin-create';
    const adminKey = process.env.LEVYNI_CO_ADMIN_KEY;
    if (!adminKey) {
      return res.status(500).json({ error: 'Server missing LEVYNI_CO_ADMIN_KEY' });
    }

    const remoteRes = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: inv.email,
        password: inv.temp_password,
        username: inv.username,
        adminKey,
      }),
    });
    const remote = await remoteRes.json().catch(() => ({}));

    if (remoteRes.status === 409 && remote.alreadyRegistered) {
      await db.query(`UPDATE registration_invites SET used_at = NOW() WHERE id = ?`, [inv.id]);
      await db.query(
        `UPDATE applications SET levyni_co_user_id = ?, levyni_co_created_at = NOW() WHERE id = ?`,
        [String(remote.userId || 'existing'), inv.app_id]
      );
      return res.json({
        success: true,
        alreadyRegistered: true,
        message: 'You already have a Levyni Co account. Sign in with your existing password.',
        loginUrl: process.env.LEVYNI_CO_LOGIN_URL || 'https://levyni.com/signin',
      });
    }

    if (!remoteRes.ok) {
      return res.status(502).json({
        error: remote.error || remote.message || 'Could not create Levyni Co account',
      });
    }

    const userId = remote.userId || remote.user?.userId || 'created';
    await db.query(`UPDATE registration_invites SET used_at = NOW() WHERE id = ?`, [inv.id]);
    await db.query(
      `UPDATE applications SET levyni_co_user_id = ?, levyni_co_created_at = NOW() WHERE id = ?`,
      [String(userId), inv.app_id]
    );

    res.json({
      success: true,
      message: 'Account created. Sign in with the email and password from your invite email, then change your password.',
      userId,
      email: inv.email,
      loginUrl: process.env.LEVYNI_CO_LOGIN_URL || 'https://levyni.com/signin',
      // password only returned once so the register page can show it if needed
      temporaryPassword: inv.temp_password,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

// GET /api/applications/:id/status — lets an applicant check their own status
router.get('/:id/status', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, status, tier, created_at FROM applications WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch status' });
  }
});

module.exports = router;
