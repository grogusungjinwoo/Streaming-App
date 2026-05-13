export type VoiceMasteringMode = "off" | "natural" | "broadcast" | "synthetic-pitch-lock";

export type VoiceMasteringSettings = {
  mode: VoiceMasteringMode;
  masteringStrength: number;
  pitchLockAmount: number;
  frequencySculptor: {
    rumbleCut: number;
    warmth: number;
    presence: number;
    harshness: number;
    deCrackle: number;
  };
};

export type VoiceRenderDiagnostics = {
  mode: VoiceMasteringMode;
  targetPitchHz: number;
  voicedFrameConfidence: number;
  clippingCount: number;
  peakLevel: number;
  sampleRate: number;
  appliedFilterProfile: string;
};

export type VoiceMasteringFilterProfile = "advanced" | "compatible";

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function buildVoiceMasteringFilter(settings: VoiceMasteringSettings, profile: VoiceMasteringFilterProfile = "advanced"): string {
  const normalized = normalizeSettings(settings);
  if (normalized.mode === "off") return "anull";

  const sculptor = normalized.frequencySculptor;
  const strength = normalized.masteringStrength;
  const rumbleCut = Math.round(55 + sculptor.rumbleCut * 45);
  const lowpass = Math.round(16_000 - sculptor.harshness * 2_500);
  const deCrackleNoiseReduction = (4 + sculptor.deCrackle * 6).toFixed(1);
  const noiseFloor = Math.round(-30 - strength * 10);
  const warmthGain = (sculptor.warmth * 2.4).toFixed(1);
  const presenceGain = (sculptor.presence * 1.6).toFixed(1);
  const harshnessCut = (-(1 + sculptor.harshness * 2.8)).toFixed(1);
  const limiter = (0.91 - strength * 0.03).toFixed(2);

  const baseFilters = [
    "aformat=sample_fmts=fltp:sample_rates=48000",
    "aresample=48000:async=1:first_pts=0",
    `highpass=f=${rumbleCut}`,
    `lowpass=f=${lowpass}`,
    `afftdn=nr=${deCrackleNoiseReduction}:nf=${noiseFloor}:tn=1`,
    `equalizer=f=180:t=q:w=0.9:g=${warmthGain}`,
    `equalizer=f=3200:t=q:w=1.1:g=${presenceGain}`,
    `equalizer=f=5200:t=q:w=1.4:g=${harshnessCut}`
  ];

  const filters =
    profile === "compatible"
      ? [
          ...baseFilters,
          `acompressor=threshold=${(-20 - strength * 6).toFixed(1)}dB:ratio=${(2.2 + strength * 1.8).toFixed(
            1
          )}:attack=8:release=140:makeup=1`,
          `alimiter=limit=${limiter}:attack=5:release=80`,
          "aformat=sample_fmts=fltp:sample_rates=48000"
        ]
      : [
          baseFilters[0],
          baseFilters[1],
          "adeclick",
          "adeclip",
          ...baseFilters.slice(2),
          "mcompand=0.008\\,0.060 6 -70/-70\\,-45/-36\\,-24/-20\\,-8/-7\\,0/-6 1200",
          `dynaudnorm=f=250:g=${(9 + strength * 8).toFixed(1)}:p=0.92:m=5:s=6`,
          "compand=attacks=0.006:decays=0.12:points=-80/-80|-50/-45|-30/-24|-12/-10|0/-5:soft-knee=6:gain=0:volume=-18:delay=0.006",
          `alimiter=limit=${limiter}:attack=5:release=80`,
          "aformat=sample_fmts=fltp:sample_rates=48000"
        ];

  return filters.join(",");
}

export function applySyntheticPitchLock(
  samples: Float32Array,
  sampleRate: number,
  settings: VoiceMasteringSettings
): { samples: Float32Array; diagnostics: VoiceRenderDiagnostics } {
  const normalized = normalizeSettings(settings);
  const analysis = analyzePitch(samples, sampleRate);
  const clippingCount = countClippedSamples(samples);

  if (normalized.mode !== "synthetic-pitch-lock" || analysis.targetPitchHz <= 0 || normalized.pitchLockAmount <= 0) {
    return {
      samples: new Float32Array(samples),
      diagnostics: buildDiagnostics(normalized.mode, analysis.targetPitchHz, analysis.confidence, clippingCount, samples, sampleRate)
    };
  }

  const output = new Float32Array(samples.length);
  const amount = normalized.pitchLockAmount;
  let envelope = 0;
  let phase = 0;
  const phaseStep = (2 * Math.PI * analysis.targetPitchHz) / sampleRate;

  for (let index = 0; index < samples.length; index += 1) {
    const dry = samples[index];
    envelope += (Math.abs(dry) - envelope) * 0.004;
    phase += phaseStep;
    if (phase > Math.PI * 2) phase -= Math.PI * 2;
    const synthetic = Math.sin(phase) * envelope * Math.sign(dry || Math.sin(phase));
    output[index] = clamp(dry * (1 - amount) + synthetic * amount, -0.98, 0.98);
  }

  return {
    samples: output,
    diagnostics: buildDiagnostics("synthetic-pitch-lock", analysis.targetPitchHz, analysis.confidence, clippingCount, output, sampleRate)
  };
}

export function decodePcm16Wav(bytes: Uint8Array): { sampleRate: number; samples: Float32Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let sampleRate = 48_000;
  let channels = 1;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const chunkData = offset + 8;
    if (chunkId === "fmt ") {
      channels = view.getUint16(chunkData + 2, true);
      sampleRate = view.getUint32(chunkData + 4, true);
    } else if (chunkId === "data") {
      dataOffset = chunkData;
      dataLength = chunkLength;
      break;
    }
    offset = chunkData + chunkLength + (chunkLength % 2);
  }

  if (dataOffset < 0) throw new Error("PCM WAV data was not found.");
  const frameCount = Math.floor(dataLength / 2 / channels);
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += view.getInt16(dataOffset + (frame * channels + channel) * 2, true) / 32768;
    }
    samples[frame] = sum / channels;
  }
  return { sampleRate, samples };
}

export function encodePcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataLength = samples.length * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataLength, true);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(44 + index * 2, Math.round(clamp(samples[index], -1, 1) * 32767), true);
  }
  return bytes;
}

function normalizeSettings(settings: VoiceMasteringSettings): VoiceMasteringSettings {
  return {
    mode: settings.mode,
    masteringStrength: clamp(settings.masteringStrength, 0, 1),
    pitchLockAmount: clamp(settings.pitchLockAmount, 0, 1),
    frequencySculptor: {
      rumbleCut: clamp(settings.frequencySculptor.rumbleCut, 0, 1),
      warmth: clamp(settings.frequencySculptor.warmth, 0, 1),
      presence: clamp(settings.frequencySculptor.presence, 0, 1),
      harshness: clamp(settings.frequencySculptor.harshness, 0, 1),
      deCrackle: clamp(settings.frequencySculptor.deCrackle, 0, 1)
    }
  };
}

function analyzePitch(samples: Float32Array, sampleRate: number): { targetPitchHz: number; confidence: number } {
  const frameSize = 2048;
  const hopSize = 1024;
  const pitches: number[] = [];
  const confidences: number[] = [];
  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    const pitch = detectFramePitch(samples.subarray(offset, offset + frameSize), sampleRate);
    if (pitch.confidence > 0.52) {
      pitches.push(pitch.frequencyHz);
      confidences.push(pitch.confidence);
    }
  }
  if (pitches.length === 0) return { targetPitchHz: 0, confidence: 0 };
  return {
    targetPitchHz: quantizeFrequency(median(pitches)),
    confidence: median(confidences)
  };
}

function detectFramePitch(frame: Float32Array, sampleRate: number): { frequencyHz: number; confidence: number } {
  const minLag = Math.floor(sampleRate / 360);
  const maxLag = Math.floor(sampleRate / 70);
  let bestLag = 0;
  let bestCorrelation = -1;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const normalized = getLagCorrelation(frame, lag);
    if (normalized > bestCorrelation) {
      bestCorrelation = normalized;
      bestLag = lag;
    }
  }
  const refinedLag = refinePitchLag(frame, bestLag, minLag, maxLag);
  return { frequencyHz: refinedLag ? sampleRate / refinedLag : 0, confidence: clamp(bestCorrelation, 0, 1) };
}

function getLagCorrelation(frame: Float32Array, lag: number): number {
  let correlation = 0;
  let energyA = 0;
  let energyB = 0;
  for (let index = 0; index + lag < frame.length; index += 1) {
    const a = frame[index];
    const b = frame[index + lag];
    correlation += a * b;
    energyA += a * a;
    energyB += b * b;
  }
  return correlation / Math.sqrt(Math.max(energyA * energyB, 1e-12));
}

function refinePitchLag(frame: Float32Array, bestLag: number, minLag: number, maxLag: number): number {
  if (bestLag <= minLag || bestLag >= maxLag) return bestLag;
  const left = getLagCorrelation(frame, bestLag - 1);
  const center = getLagCorrelation(frame, bestLag);
  const right = getLagCorrelation(frame, bestLag + 1);
  const denominator = left - 2 * center + right;
  if (Math.abs(denominator) < 1e-9) return bestLag;
  return clamp(bestLag + 0.5 * ((left - right) / denominator), minLag, maxLag);
}

function quantizeFrequency(frequencyHz: number): number {
  const midi = Math.round(69 + 12 * Math.log2(frequencyHz / 440));
  return 440 * 2 ** ((midi - 69) / 12);
}

function buildDiagnostics(
  mode: VoiceMasteringMode,
  targetPitchHz: number,
  voicedFrameConfidence: number,
  clippingCount: number,
  samples: Float32Array,
  sampleRate: number
): VoiceRenderDiagnostics {
  return {
    mode,
    targetPitchHz,
    voicedFrameConfidence,
    clippingCount,
    peakLevel: getPeakLevel(samples),
    sampleRate,
    appliedFilterProfile: mode
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function countClippedSamples(samples: Float32Array): number {
  let count = 0;
  for (const sample of samples) if (Math.abs(sample) >= 0.98) count += 1;
  return count;
}

function getPeakLevel(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}
