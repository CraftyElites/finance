# levyni_vest — Directory Map

Real layout of `B:\Levyni Co Limited\levyni_vest` (Connect / Vest app).

```
levyni_vest/
├── .env
├── .gitignore
├── README.md
├── package.json
├── package-lock.json
├── levyni_vest.zip
├── dir.md                          ← this file
│
├── migrations/
│   ├── 001_init.sql
│   ├── 002_questions.sql
│   ├── 003_tier_settings.sql
│   ├── 004_outreach_files.sql
│   ├── 005_call_schedule.sql
│   ├── 006_logo_and_levyni_co.sql
│   └── 007_registration_invites.sql
│
├── public/
│   ├── index.html                  ← landing
│   ├── apply.html                  ← onboarding (+ logo)
│   ├── assessment.html             ← one-time assessment
│   ├── register.html               ← redeem Levyni Co invite link
│   ├── assets/
│   │   └── logo.png
│   └── admin/
│       ├── login.html
│       └── dashboard.html          ← admin SPA
│
├── src/
│   ├── server.js                   ← Express entry
│   ├── db.js
│   ├── middleware/
│   │   └── auth.js
│   ├── routes/
│   │   ├── admin.js
│   │   ├── applications.js
│   │   ├── assessment.js
│   │   └── tiers.js
│   └── utils/
│       ├── email.js
│       ├── pitch-pdf.js
│       ├── createAdmin.js
│       ├── migrate.js
│       ├── transcribe.js
│       ├── transcribe-engine.js
│       ├── setup-models (2).sh
│       └── models/                 ← sherpa-onnx STT weights
│           ├── embed.onnx
│           ├── sherpa-onnx-pyannote-segmentation-3-0/
│           ├── sherpa-onnx-whisper-small.en/
│           └── sherpa-onnx-whisper-tiny.en/
│
└── uploads/                        ← runtime (gitignored ideally)
    └── applications/
        └── {applicationId}/
            ├── logo.jpg
            ├── invoice.pdf
            └── call-audio.aac
```

---

## What lives where

| Path | Role |
|------|------|
| `src/server.js` | App entry — static `public/`, mounts `/api` |
| `src/db.js` | MySQL pool |
| `src/middleware/auth.js` | Admin JWT / session guard |
| `src/routes/applications.js` | Public apply, cohort status, register redeem |
| `src/routes/admin.js` | Outreach, files, accept/reject, invites |
| `src/routes/assessment.js` | Assessment token flow |
| `src/routes/tiers.js` | Tier CRUD / public list |
| `src/utils/email.js` | Nodemailer templates + attachments |
| `src/utils/pitch-pdf.js` | pdfkit pitch brief |
| `src/utils/transcribe.js` | ffmpeg → wav + engine wrapper |
| `src/utils/transcribe-engine.js` | sherpa-onnx diarization/STT |
| `src/utils/models/` | ONNX models (large; keep out of git if possible) |
| `public/admin/dashboard.html` | Admin UI |
| `public/register.html` | Invite link landing page |
| `migrations/` | SQL in numeric order only |

---

## Migrations (run in order)

```
001_init.sql
002_questions.sql
003_tier_settings.sql
004_outreach_files.sql
005_call_schedule.sql
006_logo_and_levyni_co.sql
007_registration_invites.sql
```

---

## Public pages

| URL | File |
|-----|------|
| `/` | `public/index.html` |
| `/apply.html` | `public/apply.html` |
| `/assessment.html` | `public/assessment.html` |
| `/register.html?token=…` | `public/register.html` |
| `/admin/login.html` | `public/admin/login.html` |
| `/admin/dashboard.html` | `public/admin/dashboard.html` |

---

## Uploads layout

```
uploads/applications/{uuid}/
  logo.jpg | logo.png | …
  invoice.pdf
  call-audio.aac | call-audio.wav | …
```

Created at runtime when applicants upload logos or admins upload invoice/audio.

---

## Levyni Co (separate repo)

Not inside this tree. On the Co server, add:

- `POST /api/auth/admin-create` — body `{ email, password, username, adminKey }` (no OTP)

Connect calls it from `POST /api/applications/register/:token` using:

```env
LEVYNI_CO_ADMIN_CREATE_URL=https://levyni.com/api/auth/admin-create
LEVYNI_CO_ADMIN_KEY=…
LEVYNI_CO_LOGIN_URL=https://levyni.com/signin
APP_URL=https://your-vest-domain
```

---

## Notes

- Admin dashboard is under **`public/admin/`**, not `public/dashboard.html`.
- Server entry is **`src/server.js`**, not root `server.js`.
- Migration `005` is named **`005_call_schedule.sql`** (not `005_call_scheduled_at.sql`).
- STT models sit under **`src/utils/models/`** (not a root `models/` folder).
- `node_modules/` exists but is omitted from the tree above on purpose.
