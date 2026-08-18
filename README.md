# Levyni Connect

Full-stack app: founders apply for a tier → fill an onboarding profile → an admin
reviews the application on a dashboard → **Accept** emails the founder a one-time
assessment link → the founder completes the quiz → the link is burned and can never
be opened again.

## How the pieces fit

```
public/index.html        Landing page — pick a tier → apply.html?tier=X
public/apply.html        Onboarding form → POST /api/applications
public/assessment.html   Token-gated quiz → GET/POST /api/assessment/:token
public/admin/login.html  Admin sign-in → POST /api/admin/login
public/admin/dashboard.html  Review queue, Accept / Reject buttons

src/server.js             Express app, mounts routes, serves /public
src/routes/applications.js   Public: submit application
src/routes/admin.js          Admin-only: list, accept, reject, resend
src/routes/assessment.js     Public but token-gated: validate + submit quiz
src/db.js                    Postgres pool (Neon-ready)
src/utils/email.js           Nodemailer — acceptance & rejection emails
migrations/001_init.sql      Schema
```

### The flow, end to end

1. **Apply** — visitor picks a tier on the landing page, fills the profile form.
   This creates an `applications` row with `status = 'pending'`.
2. **Review** — you log into `/admin/dashboard.html` and see every application,
   filterable by status.
3. **Accept** — clicking **Accept** on a pending row:
   - generates a random one-time token (`assessment_tokens`), expiring in
     `ASSESSMENT_LINK_TTL_HOURS` (default 72h)
   - emails the founder a link: `APP_URL/assessment.html?token=...`
   - sets the application to `status = 'accepted'`
4. **Assessment** — the founder opens the link. The server checks the token is
   unused, unexpired, and not revoked before showing the quiz.
5. **Submit** — on finishing the quiz, the token is marked `used_at = now()` inside
   a DB transaction — it can never be opened again ("deleted" functionally, even
   though we keep the row for audit history). The application moves to
   `status = 'assessment_done'` and the score is stored in `assessment_results`.
6. **Reject** — admins can instead reject with an optional note, which emails the
   founder and closes the loop.

The next stage (turning a completed assessment into a real user account) is a
natural follow-up — the `assessment_results` and `applications` tables already
hold everything needed to provision one; that endpoint just isn't built yet.

## Setup

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET, SMTP_* , APP_URL
npm run migrate           # creates all tables in your Postgres/Neon database
node src/utils/createAdmin.js "Your Name" "you@levyni.com" "a-strong-password"
npm run dev                # http://localhost:3000
```

Then:

- Public site: `http://localhost:3000/`
- Admin: `http://localhost:3000/admin/login.html`

### Email

Any standard SMTP provider works (Gmail app password, Zoho, Brevo, Resend SMTP,
etc.) — set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` in `.env`.

### Deploying (Render + Neon, matching your usual stack)

1. Create a Neon Postgres database, copy its connection string into `DATABASE_URL`
   (keep `?sslmode=require`).
2. Push this repo, create a Render Web Service pointing at it, build command
   `npm install`, start command `npm start`.
3. Set all `.env` variables as Render environment variables, with `APP_URL` set
   to your Render URL (so assessment links point to the right place).
4. Run `npm run migrate` once (Render Shell, or a one-off job) and create your
   first admin with `createAdmin.js`.

## Notes / things you may want to extend

- The landing page's "Pay via Paystack" step is still the original mock —
  clicking a tier now routes straight to the onboarding form. Wiring real
  Paystack verification before creating the application is a clean next step.
- Admin auth uses a JWT stored in `localStorage`. Fine for an internal single-admin
  tool; swap for httpOnly cookies if you open this to more staff.
- Rate limiting is on `/api/applications` and `/api/admin/login` to blunt spam/
  brute force; tune the numbers in `src/server.js` as needed.
