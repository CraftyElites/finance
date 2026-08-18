/**
 * Beautiful pitch PDF from application + call transcript.
 * Requires: npm i pdfkit
 */
const PDFDocument = require('pdfkit');

const COLORS = {
  ink: '#0f1412',
  muted: '#5c6b63',
  line: '#e2e8e4',
  mint: '#0d9f6e',
  naira: '#c47a2c',
  paper: '#f7f9f8',
};

function drawHeader(doc, width) {
  doc.save();
  doc.rect(0, 0, width, 72).fill(COLORS.ink);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18);
  doc.text('Levyni Connect', 48, 28, { continued: false });
  doc.fillColor('#a8b5ad').font('Helvetica').fontSize(9);
  doc.text('FOUNDER PITCH BRIEF', 48, 50);
  doc.restore();
}

function sectionTitle(doc, title, y) {
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11);
  doc.text(title.toUpperCase(), 48, y, { characterSpacing: 0.8 });
  const after = doc.y + 4;
  doc.moveTo(48, after).lineTo(doc.page.width - 48, after).strokeColor(COLORS.line).lineWidth(1).stroke();
  return after + 12;
}

/**
 * @param {object} app  application row
 * @returns {Promise<Buffer>}
 */
function buildPitchPdf(app) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 96, bottom: 56, left: 48, right: 48 },
      info: {
        Title: `Pitch brief — ${app.full_name || 'Applicant'}`,
        Author: 'Levyni Connect',
      },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    drawHeader(doc, pageW);

    // Title block
    let y = 96;
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(20);
    doc.text(app.business_name || app.full_name || 'Pitch brief', 48, y, {
      width: pageW - 96,
    });
    y = doc.y + 6;
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(10);
    doc.text(
      [
        app.full_name,
        app.tier ? `${app.tier} tier` : null,
        app.industry || null,
      ]
        .filter(Boolean)
        .join('  ·  '),
      48,
      y,
      { width: pageW - 96 }
    );
    y = doc.y + 18;

    // Meta cards row
    const meta = [
      ['Applicant', app.full_name || '—'],
      ['Email', app.email || '—'],
      ['Tier', app.tier || '—'],
      ['Linking fee', app.tier_amount != null ? `₦${Number(app.tier_amount).toLocaleString()}` : '—'],
    ];
    const colW = (pageW - 96 - 12) / 2;
    meta.forEach((pair, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 48 + col * (colW + 12);
      const my = y + row * 44;
      doc.roundedRect(x, my, colW, 38, 6).fill(COLORS.paper);
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(pair[0].toUpperCase(), x + 12, my + 8);
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10).text(String(pair[1]), x + 12, my + 20, {
        width: colW - 24,
        ellipsis: true,
      });
    });
    y += 44 * 2 + 20;

    // Call schedule if set
    if (app.call_scheduled_at) {
      y = sectionTitle(doc, 'Scheduled call', y);
      doc.fillColor(COLORS.ink).font('Helvetica').fontSize(10);
      const when = new Date(app.call_scheduled_at).toLocaleString('en-NG', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'Africa/Lagos',
      });
      doc.text(when + ' (WAT)', 48, y, { width: pageW - 96 });
      y = doc.y + 16;
    }

    // Business snapshot
    y = sectionTitle(doc, 'Business snapshot', y);
    doc.y = y;
    const snapshot = [
      ['Stage', app.stage],
      ['Monthly revenue', app.monthly_revenue],
      ['Team size', app.team_size],
      ['Amount seeking', app.amount_seeking],
      ['Industry', app.industry],
    ].filter(([, v]) => v != null && String(v).trim() !== '');

    if (snapshot.length) {
      snapshot.forEach(([label, value]) => {
        doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9);
        doc.text(label, 48, doc.y, { width: 120, continued: false });
        const labelY = doc.y;
        doc.fillColor(COLORS.ink).font('Helvetica').fontSize(10);
        doc.text(String(value), 170, labelY - 11, { width: pageW - 218 });
        doc.moveDown(0.35);
      });
    } else {
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(10).text('No extra business fields on file.');
    }
    y = doc.y + 14;

    // Transcript / call notes
    const transcript = app.call_transcript || app.admin_note || '';
    y = sectionTitle(doc, 'Call transcript', y);
    doc.y = y;

    if (transcript && String(transcript).trim()) {
      const lines = String(transcript).split(/\n+/);
      lines.forEach((line) => {
        if (doc.y > doc.page.height - 72) {
          doc.addPage();
          drawHeader(doc, pageW);
          doc.y = 96;
        }
        const isSpeaker = /^\[Speaker/i.test(line.trim());
        if (isSpeaker) {
          doc.moveDown(0.25);
          doc.fillColor(COLORS.mint).font('Helvetica-Bold').fontSize(9);
          doc.text(line.trim(), 48, doc.y, { width: pageW - 96 });
        } else {
          doc.fillColor(COLORS.ink).font('Helvetica').fontSize(10);
          doc.text(line.trim() || ' ', 48, doc.y, { width: pageW - 96, align: 'left', lineGap: 2 });
        }
      });
    } else {
      doc.fillColor(COLORS.muted).font('Helvetica-Oblique').fontSize(10);
      doc.text('No transcript yet. Upload call audio and run Transcribe on the dashboard.', 48, y, {
        width: pageW - 96,
      });
    }

    // Footer on each page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8);
      doc.text(
        `Levyni Connect  ·  Generated ${new Date().toLocaleDateString('en-NG')}  ·  Page ${i - range.start + 1} of ${range.count}`,
        48,
        doc.page.height - 36,
        { width: pageW - 96, align: 'center' }
      );
    }

    doc.end();
  });
}

module.exports = { buildPitchPdf };
