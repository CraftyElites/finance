#!/usr/bin/env bash
# Downloads the free, open-source models Splitline needs.
# Run this once after `npm install`. Requires internet access and ~500MB free space.
set -e

cd "$(dirname "$0")"
mkdir -p models
cd models

echo "==> Downloading transcription model (Whisper small.en, ~460MB, much more accurate than tiny/base)..."
if [ ! -d "sherpa-onnx-whisper-small.en" ]; then
  curl -L -o whisper-small.tar.bz2 "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.en.tar.bz2"
  tar xjf whisper-small.tar.bz2
  rm whisper-small.tar.bz2
else
  echo "    already present, skipping."
fi

echo "==> Downloading speaker segmentation model (~7MB)..."
if [ ! -d "sherpa-onnx-pyannote-segmentation-3-0" ]; then
  curl -L -o seg.tar.bz2 "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
  tar xjf seg.tar.bz2
  rm seg.tar.bz2
else
  echo "    already present, skipping."
fi

echo "==> Downloading speaker embedding model (~30MB)..."
if [ ! -f "embed.onnx" ]; then
  curl -L -o embed.onnx "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx"
else
  echo "    already present, skipping."
fi

echo ""
echo "Done. Run 'npm start' to launch Splitline at http://localhost:3000"