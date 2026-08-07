// lib/pitch.ts — WAV → PCM samples → native pitch detection.
// The PCM-in boundary (handoff §8): JS owns WAV reading + decimation,
// native owns only the pitch math. This keeps a future Android port to
// just swapping the native module.
import { File } from 'expo-file-system';
import { detectPitch as detectPitchNative, type PitchFrame } from '@/modules/expo-pitch'; // ← confirm specifier

export type { PitchFrame };

function parseWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let offset = 12; // skip "RIFF" + size + "WAVE"
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let numChannels = 1;
  let dataStart = -1;
  let dataLen = 0;

  while (offset + 8 <= dv.byteLength) {
    const id = String.fromCharCode(
      dv.getUint8(offset), dv.getUint8(offset + 1),
      dv.getUint8(offset + 2), dv.getUint8(offset + 3),
    );
    const size = dv.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      numChannels = dv.getUint16(body + 2, true);
      sampleRate = dv.getUint32(body + 4, true);
      bitsPerSample = dv.getUint16(body + 14, true);
    } else if (id === 'data') {
      dataStart = body;
      dataLen = size;
      break;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  if (dataStart < 0 || bitsPerSample !== 16) {
    throw new Error(`unexpected WAV: bits=${bitsPerSample}, dataStart=${dataStart}`);
  }

  const totalSamples = Math.floor(dataLen / 2);
  const frameCount = Math.floor(totalSamples / numChannels);
  const out = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    const s = dv.getInt16(dataStart + i * numChannels * 2, true);
    out[i] = s / 32768;
  }
  return { samples: out, sampleRate };
}

// Integer-factor decimation with a box average (crude anti-alias). Pitch detection
// (f0 75–400 Hz) doesn't need full bandwidth, and a lower rate keeps the native
// window (W=512) wide enough to reach the lowest pitch.
function decimate(samples: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return samples;
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += samples[i * factor + j];
    out[i] = sum / factor;
  }
  return out;
}

// Read a recorded WAV and return voiced pitch frames. Returns [] on any
// failure so callers can pass the result straight through; computeMetrics
// already treats too-few-frames (and absence) as "no intonation metric".
export async function extractPitchFrames(uri: string): Promise<PitchFrame[]> {
  try {
    const bytes = await new File(uri).bytes();
    const { samples, sampleRate } = parseWav(bytes);

    // Decimate toward ~8 kHz for ANY input rate, then pass the decimated rate into
    // native. The recorder asks for 16k, but iOS can hand back another rate; at the
    // native W=512 a rate above ~19 kHz would cap the lowest detectable pitch above
    // a male voice, so never skip this. `ds`/`dsRate` must stay in lockstep:
    // detectPitch timestamps each frame as start/dsRate, so a wrong rate silently
    // shifts the whole contour time-axis with no error. (handoff snag 2)
    const TARGET_RATE = 8000;
    const factor = Math.max(1, Math.round(sampleRate / TARGET_RATE));
    const ds = decimate(samples, factor);
    const dsRate = sampleRate / factor;

    // Native expects a plain number[] (the copied-array bridge path, §8 decision
    // A — NOT a Float32Array). This Array.from copy is the conversion cost noted
    // in §14; it's on top of the bridge copy. Measure before optimizing.
    const frames = await detectPitchNative(Array.from(ds), dsRate);
    return frames;
  } catch (e) {
    console.warn('[pitch] extraction failed:', e);
    return [];
  }
}