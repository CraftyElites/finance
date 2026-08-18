const sherpa = require('sherpa-onnx-node');
const path = require('path');
const { execFile } = require('child_process');
const util = require('util');
const execFileP = util.promisify(execFile);

const M = (p) => path.join(__dirname, 'models', p);

let diarizerCache = new Map();
let recognizer = null;

// numSpeakers: -1 = auto-detect, or a positive integer to force an exact count
function getDiarizer(numSpeakers = -1) {
  const key = String(numSpeakers);
  if (!diarizerCache.has(key)) {
    diarizerCache.set(key, new sherpa.OfflineSpeakerDiarization({
      segmentation: {
        pyannote: { model: M('sherpa-onnx-pyannote-segmentation-3-0/model.onnx') },
      },
      embedding: { model: M('embed.onnx') },
      // Tighter clustering threshold = fewer speakers wrongly merged together;
      // shorter minDurationOn/Off = short interjections ("mm-hmm", cross-talk) aren't dropped.
      clustering: { numClusters: numSpeakers, threshold: 0.4 },
      minDurationOn: 0.2,
      minDurationOff: 0.3,
    }));
  }
  return diarizerCache.get(key);
}

// Fine-tuned model support: if models/finetuned/ exists (produced by the
// fine-tuning pipeline in /finetune), it's used automatically instead of the
// stock small.en weights. See /finetune/README.md.
const fs = require('fs');
const FINETUNED_DIR = M('finetuned');
const useFinetuned = fs.existsSync(path.join(FINETUNED_DIR, 'encoder.int8.onnx')) &&
  fs.existsSync(path.join(FINETUNED_DIR, 'decoder.int8.onnx'));

function getRecognizer() {
  if (!recognizer) {
    const whisperCfg = useFinetuned
      ? {
          encoder: path.join(FINETUNED_DIR, 'encoder.int8.onnx'),
          decoder: path.join(FINETUNED_DIR, 'decoder.int8.onnx'),
        }
      : {
          encoder: M('sherpa-onnx-whisper-small.en/small.en-encoder.int8.onnx'),
          decoder: M('sherpa-onnx-whisper-small.en/small.en-decoder.int8.onnx'),
        };
    const tokensPath = useFinetuned
      ? path.join(FINETUNED_DIR, 'tokens.txt')
      : M('sherpa-onnx-whisper-small.en/small.en-tokens.txt');

    if (useFinetuned) console.log('[engine] Using fine-tuned model from', FINETUNED_DIR);

    recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        whisper: whisperCfg,
        tokens: tokensPath,
        numThreads: 2,
      },
    });
  }
  return recognizer;
}

// Convert any input audio (aac/mp3/m4a/wav/etc) to 16kHz mono PCM wav
async function convertToWav(inputPath, outputPath) {
  await execFileP('ffmpeg', [
    '-y', '-i', inputPath,
    '-ac', '1', '-ar', '16000',
    '-c:a', 'pcm_s16le',
    outputPath,
  ]);
}

function transcribeSamples(samples, sampleRate) {
  const rec = getRecognizer();
  const stream = rec.createStream();
  stream.acceptWaveform({ sampleRate, samples });
  rec.decode(stream);
  return rec.getResult(stream).text.trim();
}

// Full pipeline: wav path -> array of { start, end, speaker, text }
async function processWav(wavPath, numSpeakers = -1) {
  const wave = sherpa.readWave(wavPath);
  const sr = wave.sampleRate;

  const sd = getDiarizer(numSpeakers);
  const rawSegments = sd.process(wave.samples);
  const segments = [...rawSegments].sort((a, b) => a.start - b.start);

  const results = [];
  for (const seg of segments) {
    const startSample = Math.floor(seg.start * sr);
    const endSample = Math.min(Math.floor(seg.end * sr), wave.samples.length);
    if (endSample - startSample < sr * 0.15) continue; // skip too-short slivers
    const clip = wave.samples.subarray(startSample, endSample);
    let text = '';
    try {
      text = transcribeSamples(clip, sr);
    } catch (e) {
      text = '';
    }
    if (text) {
      results.push({
        start: Number(seg.start.toFixed(2)),
        end: Number(seg.end.toFixed(2)),
        speaker: seg.speaker,
        text,
      });
    }
  }
  return results;
}

module.exports = { convertToWav, processWav };