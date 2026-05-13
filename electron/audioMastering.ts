export type VoiceMasteringMode = "off" | "natural" | "broadcast" | "synthetic-pitch-lock" | "smooth-vocal";

export type VoiceCleanupSettings = {
  highPassHz: number;
  gateThresholdDb: number;
  gateStrength: number;
  deEssAmount: number;
  transientSmoothing: number;
  vocalLeveling: number;
};

export type PitchCorrectionSettings = {
  strength: number;
  smoothing: number;
  correctionSpeed: number;
  maxCentsPerSecond: number;
  targetMode: "speech-smooth" | "scale";
  scaleKey: string;
  scaleType: "chromatic" | "major" | "minor";
};

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
  voiceCleanup: VoiceCleanupSettings;
  pitchCorrection: PitchCorrectionSettings;
};

export type PitchDiagnosticFrame = {
  timeSeconds: number;
  rawPitchHz: number;
  smoothedPitchHz: number;
  targetPitchHz: number;
  correctionCents: number;
  voiced: boolean;
  confidence: number;
  gateReduction: number;
};

export type VoiceRenderDiagnostics = {
  mode: VoiceMasteringMode;
  targetPitchHz: number;
  voicedFrameConfidence: number;
  clippingCount: number;
  peakLevel: number;
  rmsLevel: number;
  sampleRate: number;
  appliedFilterProfile: string;
  rawPitchHz: number;
  smoothedPitchHz: number;
  voicedFrameRatio: number;
  gateActivity: number;
  gainReductionDb: number;
  pitchTrace: PitchDiagnosticFrame[];
  spectralBands: number[];
};

export type VoiceMasteringFilterProfile = "advanced" | "compatible";

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const defaultVoiceCleanup: VoiceCleanupSettings = {
  highPassHz: 90,
  gateThresholdDb: -38,
  gateStrength: 0.72,
  deEssAmount: 0.65,
  transientSmoothing: 0.45,
  vocalLeveling: 0.72
};
const defaultPitchCorrection: PitchCorrectionSettings = {
  strength: 0.35,
  smoothing: 0.72,
  correctionSpeed: 0.5,
  maxCentsPerSecond: 600,
  targetMode: "speech-smooth",
  scaleKey: "C",
  scaleType: "major"
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function buildVoiceMasteringFilter(settings: VoiceMasteringSettings, profile: VoiceMasteringFilterProfile = "advanced"): string {
  const normalized = normalizeSettings(settings);
  if (normalized.mode === "off") return "anull";

  const sculptor = normalized.frequencySculptor;
  const cleanup = normalized.voiceCleanup;
  const strength = normalized.masteringStrength;
  const rumbleCut = normalized.mode === "smooth-vocal" ? Math.round(cleanup.highPassHz) : Math.round(55 + sculptor.rumbleCut * 45);
  const lowpass = Math.round(16_000 - sculptor.harshness * 2_500);
  const deCrackleNoiseReduction = (4 + sculptor.deCrackle * 6 + cleanup.gateStrength * 2).toFixed(1);
  const noiseFloor = Math.round(cleanup.gateThresholdDb - strength * 6);
  const warmthGain = (sculptor.warmth * 2.4).toFixed(1);
  const presenceGain = (sculptor.presence * 1.6).toFixed(1);
  const harshnessCut = (-(1 + sculptor.harshness * 2.8 + cleanup.deEssAmount * 0.8)).toFixed(1);
  const limiter = (0.91 - strength * 0.03).toFixed(2);
  const compressorThreshold = (-20 - strength * 7).toFixed(1);
  const compressorRatio = (2.4 + cleanup.vocalLeveling * 2.1).toFixed(1);

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
          `acompressor=threshold=${compressorThreshold}dB:ratio=${compressorRatio}:attack=8:release=160:makeup=1`,
          `alimiter=limit=${limiter}:attack=5:release=80`,
          "aformat=sample_fmts=fltp:sample_rates=48000"
        ]
      : [
          baseFilters[0],
          baseFilters[1],
          "adeclick",
          "adeclip",
          ...baseFilters.slice(2),
          normalized.mode === "smooth-vocal" ? `deesser=i=${(0.2 + cleanup.deEssAmount * 0.6).toFixed(2)}:m=0.5:f=0.5` : "",
          "mcompand=0.008\\,0.060 6 -70/-70\\,-45/-36\\,-24/-20\\,-8/-7\\,0/-6 1200",
          `dynaudnorm=f=250:g=${(9 + strength * 8).toFixed(1)}:p=0.92:m=5:s=6`,
          `acompressor=threshold=${compressorThreshold}dB:ratio=${compressorRatio}:attack=6:release=130:makeup=1`,
          "compand=attacks=0.006:decays=0.12:points=-80/-80|-50/-45|-30/-24|-12/-10|0/-5:soft-knee=6:gain=0:volume=-18:delay=0.006",
          `alimiter=limit=${limiter}:attack=5:release=80`,
          "aformat=sample_fmts=fltp:sample_rates=48000"
        ].filter(Boolean);

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
      diagnostics: buildDiagnostics(normalized.mode, analysis.targetPitchHz, analysis.targetPitchHz, analysis.confidence, 0, 0, [], clippingCount, samples, sampleRate)
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
    diagnostics: buildDiagnostics(
      "synthetic-pitch-lock",
      analysis.targetPitchHz,
      analysis.targetPitchHz,
      analysis.confidence,
      0,
      0,
      [],
      clippingCount,
      output,
      sampleRate
    )
  };
}

export function applySmoothVocalMastering(
  samples: Float32Array,
  sampleRate: number,
  settings: VoiceMasteringSettings
): { samples: Float32Array; diagnostics: VoiceRenderDiagnostics } {
  const normalized = normalizeSettings(settings);
  const cleaned = applyVoiceCleanupPreprocess(samples, sampleRate, normalized.voiceCleanup);
  const pitchTrace = analyzeVocalPitchFrames(cleaned.samples, sampleRate, normalized.pitchCorrection).map((frame) => ({
    ...frame,
    gateReduction: cleaned.averageGateReduction
  }));
  const output = applyNaturalPitchCorrection(cleaned.samples, sampleRate, pitchTrace, normalized.pitchCorrection);
  const voiced = pitchTrace.filter((frame) => frame.voiced);
  const rawPitchHz = voiced.length > 0 ? median(voiced.map((frame) => frame.rawPitchHz)) : 0;
  const smoothedPitchHz = voiced.length > 0 ? median(voiced.map((frame) => frame.smoothedPitchHz)) : 0;
  const confidence = voiced.length > 0 ? median(voiced.map((frame) => frame.confidence)) : 0;

  return {
    samples: output,
    diagnostics: buildDiagnostics(
      "smooth-vocal",
      rawPitchHz,
      smoothedPitchHz,
      confidence,
      pitchTrace.length > 0 ? voiced.length / pitchTrace.length : 0,
      cleaned.averageGateReduction,
      pitchTrace,
      countClippedSamples(output),
      output,
      sampleRate,
      estimateGainReductionDb(samples, output)
    )
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

function applyVoiceCleanupPreprocess(
  samples: Float32Array,
  sampleRate: number,
  settings: VoiceCleanupSettings
): { samples: Float32Array; averageGateReduction: number } {
  let output = removeDcOffset(samples);
  output = applyHighPass(output, sampleRate, settings.highPassHz);
  const gated = applyLookaheadGate(output, sampleRate, settings);
  output = applyDeEsser(gated.samples, sampleRate, settings.deEssAmount);
  output = applyTransientSmoothing(output, settings.transientSmoothing);
  output = applyVocalLeveling(output, sampleRate, settings.vocalLeveling);
  return { samples: limitSamples(output), averageGateReduction: gated.averageReduction };
}

function analyzeVocalPitchFrames(
  samples: Float32Array,
  sampleRate: number,
  settings: PitchCorrectionSettings
): PitchDiagnosticFrame[] {
  const frameSize = 2048;
  const hopSize = 512;
  const frames: PitchDiagnosticFrame[] = [];
  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    const pitch = detectFramePitch(samples.subarray(offset, offset + frameSize), sampleRate);
    const voiced = pitch.confidence >= 0.62 && pitch.frequencyHz >= 70 && pitch.frequencyHz <= 360;
    frames.push({
      timeSeconds: offset / sampleRate,
      rawPitchHz: voiced ? pitch.frequencyHz : 0,
      smoothedPitchHz: voiced ? pitch.frequencyHz : 0,
      targetPitchHz: voiced ? pitch.frequencyHz : 0,
      correctionCents: 0,
      voiced,
      confidence: voiced ? pitch.confidence : 0,
      gateReduction: 0
    });
  }
  return smoothPitchFrames(frames, settings);
}

function smoothPitchFrames(frames: PitchDiagnosticFrame[], settings: PitchCorrectionSettings): PitchDiagnosticFrame[] {
  let previousSmoothed = 0;
  let previousTime = 0;
  return frames.map((frame, index) => {
    if (!frame.voiced || frame.rawPitchHz <= 0) return { ...frame, smoothedPitchHz: 0, targetPitchHz: 0, correctionCents: 0 };
    const neighbors = frames
      .slice(Math.max(0, index - 2), Math.min(frames.length, index + 3))
      .filter((candidate) => candidate.voiced && candidate.rawPitchHz > 0)
      .map((candidate) => candidate.rawPitchHz);
    const medianPitch = neighbors.length > 0 ? median(neighbors) : frame.rawPitchHz;
    const alpha = clamp(1 - settings.smoothing * 0.85, 0.08, 1);
    let smoothed = previousSmoothed > 0 ? previousSmoothed + (medianPitch - previousSmoothed) * alpha : medianPitch;
    if (previousSmoothed > 0) {
      const deltaSeconds = Math.max(1 / 120, frame.timeSeconds - previousTime);
      const maxCents = settings.maxCentsPerSecond * deltaSeconds * (0.45 + settings.correctionSpeed * 0.55);
      const maxRatio = 2 ** (maxCents / 1200);
      smoothed = clamp(smoothed, previousSmoothed / maxRatio, previousSmoothed * maxRatio);
    }
    previousSmoothed = smoothed;
    previousTime = frame.timeSeconds;
    const correctionLimit = 120 * settings.strength * (0.45 + settings.correctionSpeed * 0.55);
    const rawCorrection = 1200 * Math.log2(smoothed / frame.rawPitchHz);
    const correctionCents = clamp(rawCorrection * settings.strength, -correctionLimit, correctionLimit);
    return {
      ...frame,
      smoothedPitchHz: smoothed,
      targetPitchHz: frame.rawPitchHz * 2 ** (correctionCents / 1200),
      correctionCents
    };
  });
}

function applyNaturalPitchCorrection(
  samples: Float32Array,
  sampleRate: number,
  frames: PitchDiagnosticFrame[],
  settings: PitchCorrectionSettings
): Float32Array {
  if (settings.strength <= 0) return limitSamples(samples);
  const frameSize = 2048;
  const halfFrame = frameSize / 2;
  const accumulated = new Float32Array(samples.length);
  const weights = new Float32Array(samples.length);
  const blend = settings.strength * 0.45;
  for (const frame of frames) {
    const start = Math.round(frame.timeSeconds * sampleRate);
    const ratio = frame.voiced ? 2 ** (frame.correctionCents / 1200) : 1;
    for (let local = 0; local < frameSize; local += 1) {
      const outputIndex = start + local;
      if (outputIndex < 0 || outputIndex >= samples.length) continue;
      const sourcePosition = start + halfFrame + (local - halfFrame) * ratio;
      const shifted = interpolateSample(samples, sourcePosition);
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * local) / Math.max(1, frameSize - 1));
      accumulated[outputIndex] += (samples[outputIndex] * (1 - blend) + shifted * blend) * window;
      weights[outputIndex] += window;
    }
  }
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    output[index] = weights[index] > 0 ? accumulated[index] / weights[index] : samples[index];
  }
  return limitSamples(output);
}

function removeDcOffset(samples: Float32Array): Float32Array {
  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= Math.max(1, samples.length);
  return Float32Array.from(samples, (sample) => sample - mean);
}

function applyHighPass(samples: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  const output = new Float32Array(samples.length);
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);
  let previousInput = samples[0] ?? 0;
  let previousOutput = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index];
    output[index] = alpha * (previousOutput + current - previousInput);
    previousInput = current;
    previousOutput = output[index];
  }
  return output;
}

function applyLookaheadGate(
  samples: Float32Array,
  sampleRate: number,
  settings: VoiceCleanupSettings
): { samples: Float32Array; averageReduction: number } {
  if (settings.gateStrength <= 0) return { samples: new Float32Array(samples), averageReduction: 0 };
  const output = new Float32Array(samples.length);
  const threshold = 10 ** (settings.gateThresholdDb / 20);
  const openThreshold = threshold * (2.8 + settings.gateStrength);
  const attack = Math.exp(-1 / (sampleRate * 0.006));
  const release = Math.exp(-1 / (sampleRate * 0.09));
  let envelope = 0;
  let gain = 1;
  let reductionSum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const level = Math.abs(samples[index]);
    envelope = (level > envelope ? attack : release) * envelope + (1 - (level > envelope ? attack : release)) * level;
    const openness = clamp(envelope / Math.max(openThreshold, 1e-6), 0, 1);
    const targetGain = clamp(1 - settings.gateStrength * 1.18 * (1 - openness), 0.12, 1);
    gain += (targetGain - gain) * (targetGain < gain ? 0.22 : 0.012);
    output[index] = samples[index] * gain;
    reductionSum += 1 - gain;
  }
  return { samples: output, averageReduction: reductionSum / Math.max(1, samples.length) };
}

function applyDeEsser(samples: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount <= 0) return new Float32Array(samples);
  const output = new Float32Array(samples.length);
  const rc = 1 / (2 * Math.PI * 3200);
  const alpha = (1 / sampleRate) / (rc + 1 / sampleRate);
  let low = 0;
  let broadbandEnvelope = 0;
  let highEnvelope = 0;
  for (let index = 0; index < samples.length; index += 1) {
    low += alpha * (samples[index] - low);
    const high = samples[index] - low;
    broadbandEnvelope += (Math.abs(samples[index]) - broadbandEnvelope) * 0.008;
    highEnvelope += (Math.abs(high) - highEnvelope) * 0.025;
    const reduction = amount * clamp((highEnvelope / Math.max(broadbandEnvelope, 1e-5) - 0.1) / 0.55, 0, 0.995);
    output[index] = low + high * (1 - reduction);
  }
  return output;
}

function applyTransientSmoothing(samples: Float32Array, amount: number): Float32Array {
  if (amount <= 0) return new Float32Array(samples);
  const output = new Float32Array(samples.length);
  let previous = samples[0] ?? 0;
  output[0] = previous;
  const maxDelta = 0.22 + (1 - amount) * 0.75;
  for (let index = 1; index < samples.length; index += 1) {
    const delta = samples[index] - previous;
    const slewed = Math.abs(delta) > maxDelta ? previous + Math.sign(delta) * maxDelta : samples[index];
    output[index] = clamp(Math.tanh(slewed * (1 + amount * 0.6)) / Math.tanh(1 + amount * 0.6), -0.98, 0.98);
    previous = output[index];
  }
  return output;
}

function applyVocalLeveling(samples: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount <= 0) return new Float32Array(samples);
  const output = new Float32Array(samples.length);
  const target = 0.16 + amount * 0.06;
  const attack = Math.exp(-1 / (sampleRate * 0.012));
  const release = Math.exp(-1 / (sampleRate * 0.18));
  let envelope = 0.01;
  let gain = 1;
  for (let index = 0; index < samples.length; index += 1) {
    const level = Math.abs(samples[index]);
    envelope = (level > envelope ? attack : release) * envelope + (1 - (level > envelope ? attack : release)) * level;
    const rawGain = clamp(target / Math.max(envelope, 0.012), 0.45, 2.8);
    const desiredGain = envelope < 0.035 ? Math.min(1, rawGain) : rawGain;
    gain += (desiredGain - gain) * (0.002 + amount * 0.004);
    output[index] = samples[index] * (1 + (gain - 1) * amount);
  }
  return output;
}

function limitSamples(samples: Float32Array): Float32Array {
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) output[index] = clamp(samples[index], -0.98, 0.98);
  return output;
}

function interpolateSample(samples: Float32Array, position: number): number {
  const leftIndex = Math.floor(position);
  const rightIndex = leftIndex + 1;
  if (leftIndex < 0 || rightIndex >= samples.length) return 0;
  const fraction = position - leftIndex;
  return samples[leftIndex] * (1 - fraction) + samples[rightIndex] * fraction;
}

function normalizeSettings(settings: VoiceMasteringSettings): VoiceMasteringSettings {
  const cleanup = settings.voiceCleanup ?? defaultVoiceCleanup;
  const pitchCorrection = settings.pitchCorrection ?? defaultPitchCorrection;
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
    },
    voiceCleanup: {
      highPassHz: clamp(Number.isFinite(cleanup.highPassHz) ? cleanup.highPassHz : defaultVoiceCleanup.highPassHz, 60, 180),
      gateThresholdDb: clamp(Number.isFinite(cleanup.gateThresholdDb) ? cleanup.gateThresholdDb : defaultVoiceCleanup.gateThresholdDb, -72, -24),
      gateStrength: clamp(Number.isFinite(cleanup.gateStrength) ? cleanup.gateStrength : defaultVoiceCleanup.gateStrength, 0, 1),
      deEssAmount: clamp(Number.isFinite(cleanup.deEssAmount) ? cleanup.deEssAmount : defaultVoiceCleanup.deEssAmount, 0, 1),
      transientSmoothing: clamp(Number.isFinite(cleanup.transientSmoothing) ? cleanup.transientSmoothing : defaultVoiceCleanup.transientSmoothing, 0, 1),
      vocalLeveling: clamp(Number.isFinite(cleanup.vocalLeveling) ? cleanup.vocalLeveling : defaultVoiceCleanup.vocalLeveling, 0, 1)
    },
    pitchCorrection: {
      strength: clamp(Number.isFinite(pitchCorrection.strength) ? pitchCorrection.strength : defaultPitchCorrection.strength, 0, 1),
      smoothing: clamp(Number.isFinite(pitchCorrection.smoothing) ? pitchCorrection.smoothing : defaultPitchCorrection.smoothing, 0, 1),
      correctionSpeed: clamp(Number.isFinite(pitchCorrection.correctionSpeed) ? pitchCorrection.correctionSpeed : defaultPitchCorrection.correctionSpeed, 0, 1),
      maxCentsPerSecond: clamp(
        Number.isFinite(pitchCorrection.maxCentsPerSecond) ? pitchCorrection.maxCentsPerSecond : defaultPitchCorrection.maxCentsPerSecond,
        50,
        2400
      ),
      targetMode: pitchCorrection.targetMode === "scale" ? "scale" : "speech-smooth",
      scaleKey: noteNames.includes(pitchCorrection.scaleKey) ? pitchCorrection.scaleKey : defaultPitchCorrection.scaleKey,
      scaleType:
        pitchCorrection.scaleType === "chromatic" || pitchCorrection.scaleType === "minor" || pitchCorrection.scaleType === "major"
          ? pitchCorrection.scaleType
          : defaultPitchCorrection.scaleType
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
  rawPitchHz: number,
  targetPitchHz: number,
  voicedFrameConfidence: number,
  voicedFrameRatio: number,
  gateActivity: number,
  pitchTrace: PitchDiagnosticFrame[],
  clippingCount: number,
  samples: Float32Array,
  sampleRate: number,
  gainReductionDb = 0
): VoiceRenderDiagnostics {
  return {
    mode,
    targetPitchHz,
    voicedFrameConfidence,
    clippingCount,
    peakLevel: getPeakLevel(samples),
    rmsLevel: getRmsLevel(samples),
    sampleRate,
    appliedFilterProfile: mode,
    rawPitchHz,
    smoothedPitchHz: targetPitchHz,
    voicedFrameRatio,
    gateActivity,
    gainReductionDb,
    pitchTrace: compactPitchTrace(pitchTrace),
    spectralBands: computeSpectralBands(samples, sampleRate)
  };
}

function compactPitchTrace(frames: PitchDiagnosticFrame[]): PitchDiagnosticFrame[] {
  if (frames.length <= 48) return frames;
  const step = frames.length / 48;
  const compact: PitchDiagnosticFrame[] = [];
  for (let index = 0; index < 48; index += 1) compact.push(frames[Math.min(frames.length - 1, Math.floor(index * step))]);
  return compact;
}

function computeSpectralBands(samples: Float32Array, sampleRate: number): number[] {
  const bands = [120, 220, 420, 850, 1600, 3200, 6400, 10_000];
  const windowLength = Math.min(samples.length, Math.floor(sampleRate * 0.35));
  const start = Math.max(0, Math.floor((samples.length - windowLength) / 2));
  return bands.map((frequency) => {
    let sine = 0;
    let cosine = 0;
    for (let index = 0; index < windowLength; index += 1) {
      const sample = samples[start + index] ?? 0;
      const phase = (2 * Math.PI * frequency * index) / sampleRate;
      sine += sample * Math.sin(phase);
      cosine += sample * Math.cos(phase);
    }
    return clamp((Math.sqrt(sine * sine + cosine * cosine) / Math.max(1, windowLength)) * 18, 0, 1);
  });
}

function estimateGainReductionDb(input: Float32Array, output: Float32Array): number {
  const inputRms = getRmsLevel(input);
  const outputRms = getRmsLevel(output);
  if (inputRms <= 0 || outputRms <= 0) return 0;
  return Math.min(0, 20 * Math.log10(outputRms / inputRms));
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

function getRmsLevel(samples: Float32Array): number {
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  return Math.sqrt(sumSquares / Math.max(1, samples.length));
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}
