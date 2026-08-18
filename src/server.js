require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const applicationsRouter = require('./routes/applications');
const adminRouter = require('./routes/admin');
const assessmentRouter = require('./routes/assessment');
const tiersRouter = require('./routes/tiers');

const app = express();

app.use(helmet({ contentSecurityPolicy: false })); // CSP off: static pages pull Tailwind CDN/fonts
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Basic rate limiting on write-heavy public endpoints
const applyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

app.use('/api/applications', applyLimiter, applicationsRouter);
app.use('/api/admin/login', loginLimiter);
app.use('/api/admin', adminRouter);
app.use('/api/assessment', assessmentRouter);
app.use('/api/tiers', tiersRouter);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Static frontend (landing, apply, assessment, admin dashboard)
app.use(express.static(path.join(__dirname, '..', 'public')));
// Applicant logos + admin-uploaded files (invoice / call audio are not linked publicly in UI)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Fallback 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Levyni Connect running on http://localhost:${PORT}`);
});