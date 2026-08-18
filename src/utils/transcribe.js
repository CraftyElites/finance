/**
 * In-process transcription for Levyni Connect.
 * Wraps Splitline's sherpa-onnx engine (transcribe-engine.js).
 *
 * Layout (next to this file, or adjust ENGINE paths):
 *   utils/transcribe.js
 *   utils/transcribe-engine.js
 *   utils/models/          ← npm run setup-models (or bash setup-models.sh)
 *
 * Requires: ffmpeg on PATH, npm i sherpa-onnx-node
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const { convertToWav, processWav } = require('./transcribe-engine');

function mergeSegments(segments) {
  const merged = [];
  for (const s of segments || []) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === s.speaker && s.start - last.end < 1.0) {
      last.end = s.end;
      last.text += ' ' + s.text;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

function formatTranscript(segments) {
  if (!segments.length) return '';
  return segments
    .map((s) => {
      const who = s.speaker != null ? `Speaker ${s.speaker}` : 'Speaker';
      const span = s.start != null && s.end != null ? ` (${s.start}–${s.end}s)` : '';
      return `[${who}]${span}: ${(s.text || '').trim()}`.trim();
    })
    .join('\n');
}

/**
 * @param {string} inputPath  absolute path to call audio on disk
 * @param {{ numSpeakers?: number }} [opts]  -1 or omit = auto
 * @returns {Promise<{ segments: object[], transcript: string, speakerCount: number }>}
 */
async function transcribeFile(inputPath, opts = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('Audio file not found on disk');
  }

  const numSpeakers =
    Number.isFinite(opts.numSpeakers) && opts.numSpeakers > 0 ? opts.numSpeakers : -1;

  const tmpWav = path.join(os.tmpdir(), `levyni-tx-${randomUUID()}.wav`);
  try {
    await convertToWav(inputPath, tmpWav);
    const raw = await processWav(tmpWav, numSpeakers);
    const segments = mergeSegments(raw);
    const transcript = formatTranscript(segments);
    return {
      segments,
      transcript,
      speakerCount: new Set(segments.map((s) => s.speaker)).size,
    };
  } finally {
    fs.unlink(tmpWav, () => {});
  }
}

module.exports = { transcribeFile, formatTranscript, mergeSegments };
