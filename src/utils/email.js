const nodemailer = require('nodemailer');

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell({ title, bodyHtml }) {
  return `
  <div style="font-family: Arial, sans-serif; background:#09090b; color:#e4e4e7; padding:32px;">
    <div style="max-width:520px;margin:0 auto;background:#18181b;border-radius:16px;padding:32px;border:1px solid #27272a;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
        <div style="width:32px;height:32px;background:#10b981;border-radius:10px;display:inline-block;text-align:center;line-height:32px;font-weight:700;color:#000;">L</div>
        <span style="font-weight:700;font-size:18px;color:#fff;">Levyni Connect</span>
      </div>
      <h1 style="color:#fff;font-size:22px;margin:0 0 12px;">${title}</h1>
      ${bodyHtml}
    </div>
  </div>`;
}

async function sendAcceptanceEmail({ to, fullName, tier, assessmentUrl, expiresAt, pitchPdf }) {
  const transporter = getTransporter();

  const expiryStr = new Date(expiresAt).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const pitchLine = pitchPdf
    ? `<p style="line-height:1.6;margin:0 0 16px;">We've also attached your <strong style="color:#f59e0b;">pitch brief PDF</strong> from our call — review it alongside the assessment.</p>`
    : '';

  const html = `
  <div style="font-family: Arial, sans-serif; background:#09090b; color:#e4e4e7; padding:32px;">
    <div style="max-width:520px;margin:0 auto;background:#18181b;border-radius:16px;padding:32px;border:1px solid #27272a;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
        <div style="width:32px;height:32px;background:#10b981;border-radius:10px;display:inline-block;text-align:center;line-height:32px;font-weight:700;color:#000;">L</div>
        <span style="font-weight:700;font-size:18px;color:#fff;">Levyni Connect</span>
      </div>
      <h1 style="color:#fff;font-size:22px;margin:0 0 12px;">You're through, ${escapeHtml(fullName)} 🎉</h1>
      <p style="line-height:1.6;margin:0 0 16px;">
        Your <strong style="color:#f59e0b;">${escapeHtml(tier)}</strong> application to Levyni Connect has been
        <strong style="color:#10b981;">accepted</strong>. The next step is a short readiness assessment —
        it takes about 15&ndash;20 minutes.
      </p>
      ${pitchLine}
      <p style="line-height:1.6;margin:0 0 24px;">
        This link is <strong>one-time use</strong> and expires on <strong>${expiryStr}</strong>.
        Once you submit the assessment, the link will no longer work.
      </p>
      <a href="${assessmentUrl}"
         style="display:inline-block;background:#10b981;color:#000;font-weight:700;text-decoration:none;
                padding:14px 28px;border-radius:16px;">
        Start Assessment
      </a>
      <p style="margin-top:24px;font-size:13px;color:#71717a;line-height:1.6;">
        If the button doesn't work, copy this link into your browser:<br>
        <span style="color:#a1a1aa;">${assessmentUrl}</span>
      </p>
    </div>
  </div>`;

  const mail = {
    from: process.env.EMAIL_FROM,
    to,
    subject: pitchPdf
      ? 'Accepted — assessment link + pitch brief'
      : 'Your Levyni Connect application has been accepted',
    html,
    attachments: [],
  };
  if (pitchPdf) {
    mail.attachments.push({
      filename: 'levyni-pitch-brief.pdf',
      content: pitchPdf,
      contentType: 'application/pdf',
    });
  }
  await transporter.sendMail(mail);
}

async function sendRejectionEmail({ to, fullName, tier, note }) {
  const transporter = getTransporter();
  const html = `
  <div style="font-family: Arial, sans-serif; background:#09090b; color:#e4e4e7; padding:32px;">
    <div style="max-width:520px;margin:0 auto;background:#18181b;border-radius:16px;padding:32px;border:1px solid #27272a;">
      <h1 style="color:#fff;font-size:20px;margin:0 0 12px;">Update on your Levyni Connect application</h1>
      <p style="line-height:1.6;">
        Hi ${escapeHtml(fullName)}, thank you for applying to the ${escapeHtml(tier)} tier.
        After review, we're not able to move your application forward at this time.
      </p>
      ${note ? `<p style="line-height:1.6;color:#a1a1aa;">${escapeHtml(note)}</p>` : ''}
      <p style="line-height:1.6;">You're welcome to reapply in a future cohort.</p>
    </div>
  </div>`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Update on your Levyni Connect application',
    html,
  });
}

async function sendFollowUpEmail({ to, fullName, tier, slotFee }) {
  const transporter = getTransporter();

  const html = `
  <div style="font-family: Arial, sans-serif; background:#09090b; color:#e4e4e7; padding:32px;">
    <div style="max-width:520px;margin:0 auto;background:#18181b;border-radius:16px;padding:32px;border:1px solid #27272a;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
        <div style="width:32px;height:32px;background:#10b981;border-radius:10px;display:inline-block;text-align:center;line-height:32px;font-weight:700;color:#000;">L</div>
        <span style="font-weight:700;font-size:18px;color:#fff;">Levyni Connect</span>
      </div>
      <h1 style="color:#fff;font-size:22px;margin:0 0 12px;">Assessment received, ${escapeHtml(fullName)} ✅</h1>
      <p style="line-height:1.6;margin:0 0 16px;">
        Thanks for completing your <strong style="color:#f59e0b;">${escapeHtml(tier)}</strong> readiness assessment.
        Your result has been recorded.
      </p>
      <p style="line-height:1.6;margin:0 0 16px;">
        Next up is your follow-up slot with our team${slotFee ? ` (slot fee: <strong style="color:#f59e0b;">₦${Number(slotFee).toLocaleString()}</strong>)` : ''}.
        We'll confirm your slot time here by email and in the WhatsApp group shortly.
      </p>
      <p style="margin-top:24px;font-size:13px;color:#71717a;line-height:1.6;">
        Questions in the meantime? Just reply to this email.
      </p>
    </div>
  </div>`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Your Levyni Connect follow-up slot',
    html,
  });
}

async function sendInvoiceEmail({
  to, fullName, tier, amount, businessName, attachmentPath, registerUrl, expiresAt,
}) {
  const transporter = getTransporter();
  const naira = Number(amount || 0).toLocaleString();
  const expiryStr = expiresAt
    ? new Date(expiresAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  const registerBlock = registerUrl
    ? `
      <p style="line-height:1.6;margin:16px 0;">
        Create your <strong style="color:#f59e0b;">Levyni Co</strong> account with this one-time link
        ${expiryStr ? `(expires <strong>${escapeHtml(expiryStr)}</strong>)` : ''}:
      </p>
      <a href="${registerUrl}"
         style="display:inline-block;background:#10b981;color:#000;font-weight:700;text-decoration:none;
                padding:14px 28px;border-radius:16px;margin-bottom:8px;">
        Create Levyni Co account
      </a>
      <p style="font-size:12px;color:#71717a;line-height:1.5;margin:8px 0 0;">
        Or copy: <span style="color:#a1a1aa;">${escapeHtml(registerUrl)}</span>
      </p>`
    : '';

  const html = shell({
    title: `Invoice for your ${escapeHtml(tier)} tier`,
    bodyHtml: `
      <p style="line-height:1.6;margin:0 0 16px;">Hi ${escapeHtml(fullName)},</p>
      <p style="line-height:1.6;margin:0 0 16px;">
        Please find your linking invoice for the <strong style="color:#f59e0b;">${escapeHtml(tier)}</strong> tier
        ${businessName ? `(${escapeHtml(businessName)})` : ''}.
      </p>
      <p style="line-height:1.6;margin:0 0 16px;">
        <strong style="color:#f59e0b;">Amount due: ₦${naira}</strong>
      </p>
      <p style="line-height:1.6;margin:0 0 8px;">
        Complete payment using the details shared in WhatsApp, then send your receipt there.
      </p>
      ${registerBlock}
      <p style="margin-top:24px;font-size:13px;color:#71717a;line-height:1.6;">Questions? Just reply to this email.</p>
    `,
  });

  const mail = {
    from: process.env.EMAIL_FROM,
    to,
    subject: registerUrl
      ? `Levyni Connect — Invoice + create your Levyni Co account (${tier})`
      : `Levyni Connect — Invoice (${tier})`,
    html,
    attachments: [],
  };
  if (attachmentPath) {
    mail.attachments.push({ filename: 'levyni-invoice.pdf', path: attachmentPath });
  }
  await transporter.sendMail(mail);
}

async function sendCallScheduleEmail({ to, fullName, tier, businessName, attempt, scheduledAt }) {
  const transporter = getTransporter();
  const when = scheduledAt
    ? new Date(scheduledAt).toLocaleString('en-NG', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'Africa/Lagos',
      })
    : null;

  const whenBlock = when
    ? `<p style="line-height:1.6;margin:0 0 16px;">
         Your intro call is scheduled for:<br>
         <strong style="color:#f59e0b;font-size:16px;">${escapeHtml(when)} (WAT)</strong>
       </p>
       <p style="line-height:1.6;margin:0 0 16px;">Please confirm you can make this time, or reply with an alternative.</p>`
    : `<p style="line-height:1.6;margin:0 0 16px;">Reply with 2–3 time slots that work for you this week (WAT).</p>`;

  const html = shell({
    title: when ? 'Your intro call is scheduled' : `Schedule your intro call (${attempt}/5)`,
    bodyHtml: `
      <p style="line-height:1.6;margin:0 0 16px;">Hi ${escapeHtml(fullName)},</p>
      <p style="line-height:1.6;margin:0 0 16px;">
        ${when ? 'We have locked in a call' : "We'd like to book a short intro call"} about your
        <strong style="color:#f59e0b;">${escapeHtml(tier)}</strong> application
        ${businessName ? `for <strong>${escapeHtml(businessName)}</strong>` : ''}.
      </p>
      ${whenBlock}
      <p style="font-size:13px;color:#71717a;line-height:1.6;">Scheduling notice <strong>${attempt} of 5</strong>.</p>
    `,
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: when
      ? `Levyni Connect — Call scheduled: ${when}`
      : `Levyni Connect — Schedule your intro call (${attempt}/5)`,
    html,
  });
}

async function sendPitchEmail({ to, fullName, tier, businessName, callNotes, pdfBuffer }) {
  const transporter = getTransporter();
  const html = shell({
    title: 'Your pitch brief',
    bodyHtml: `
      <p style="line-height:1.6;margin:0 0 16px;">Hi ${escapeHtml(fullName)},</p>
      <p style="line-height:1.6;margin:0 0 16px;">
        Attached is your pitch brief PDF for
        <strong style="color:#f59e0b;">${escapeHtml(businessName || 'your business')}</strong>
        (${escapeHtml(tier)} tier), prepared from our call.
      </p>
      <p style="margin-top:24px;font-size:13px;color:#71717a;line-height:1.6;">Questions? Just reply to this email.</p>
    `,
  });

  const mail = {
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Levyni Connect — Your pitch brief',
    html,
    attachments: [],
  };
  if (pdfBuffer) {
    mail.attachments.push({
      filename: 'levyni-pitch-brief.pdf',
      content: pdfBuffer,
      contentType: 'application/pdf',
    });
  }
  await transporter.sendMail(mail);
}


async function sendLevyniCoCredentialsEmail({
  to, fullName, email, password, loginUrl, companyName, username, otpPending,
}) {
  const transporter = getTransporter();
  const otpNote = otpPending
    ? `<p style="line-height:1.6;margin:0 0 16px;">
         Levyni Co has also emailed you a <strong style="color:#f59e0b;">one-time password (OTP)</strong>.
         Enter that OTP to finish registration (it expires in about 10 minutes), then sign in with the password below.
       </p>`
    : '';

  const html = shell({
    title: otpPending ? 'Complete your Levyni Co registration' : 'Your Levyni Co account is ready',
    bodyHtml: `
      <p style="line-height:1.6;margin:0 0 16px;">Hi ${escapeHtml(fullName)},</p>
      <p style="line-height:1.6;margin:0 0 16px;">
        We've started registration for <strong style="color:#f59e0b;">${escapeHtml(companyName || 'your company')}</strong>
        on Levyni Co${username ? ` (username: <strong>${escapeHtml(username)}</strong>)` : ''}.
      </p>
      ${otpNote}
      <div style="background:#0f0f12;border:1px solid #27272a;border-radius:12px;padding:16px 18px;margin:0 0 16px;">
        <p style="margin:0 0 8px;font-size:13px;color:#a1a1aa;">Email</p>
        <p style="margin:0 0 14px;font-family:monospace;color:#fff;">${escapeHtml(email)}</p>
        <p style="margin:0 0 8px;font-size:13px;color:#a1a1aa;">Password</p>
        <p style="margin:0;font-family:monospace;color:#f59e0b;font-size:15px;">${escapeHtml(password)}</p>
      </div>
      <p style="line-height:1.6;margin:0 0 20px;">After verifying the OTP, sign in and change your password.</p>
      <a href="${loginUrl}"
         style="display:inline-block;background:#10b981;color:#000;font-weight:700;text-decoration:none;
                padding:14px 28px;border-radius:16px;">
        Open Levyni Co
      </a>
    `,
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: otpPending
      ? 'Levyni Co — verify OTP, then sign in'
      : 'Your Levyni Co login details',
    html,
  });
}

module.exports = {
  sendAcceptanceEmail,
  sendRejectionEmail,
  sendFollowUpEmail,
  sendInvoiceEmail,
  sendCallScheduleEmail,
  sendPitchEmail,
  sendLevyniCoCredentialsEmail,
};
