export type AudioCaptureProfile = "studio-raw" | "browser-cleanup" | "device-native";

export type VoiceMasteringMode = "off" | "natural" | "broadcast" | "synthetic-pitch-lock" | "smooth-vocal";

export type FrequencySculptorSettings = {
  rumbleCut: number;
  warmth: number;
  presence: number;
  harshness: number;
  deCrackle: number;
};

export type VoiceCleanupSettings = {
  highPassHz: number;
  gateThresholdDb: number;
  gateStrength: number;
  deEssAmount: number;
  transientSmoothing: number;
  vocalLeveling: number;
};

export type PitchCorrectionTargetMode = "speech-smooth" | "scale";
export type PitchCorrectionScaleType = "chromatic" | "major" | "minor";

export type PitchCorrectionSettings = {
  strength: number;
  smoothing: number;
  correctionSpeed: number;
  maxCentsPerSecond: number;
  targetMode: PitchCorrectionTargetMode;
  scaleKey: string;
  scaleType: PitchCorrectionScaleType;
};

export type VoiceMasteringSettings = {
  mode: VoiceMasteringMode;
  masteringStrength: number;
  pitchLockAmount: number;
  frequencySculptor: FrequencySculptorSettings;
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

export type PitchLockAnalysis = {
  detectedMedianPitchHz: number;
  targetPitchHz: number;
  targetNote: string;
  confidence: number;
  voicedFrameRatio: number;
};

export type PitchLockOptions = {
  pitchLockAmount: number;
};

export type MasteringFilterResult = {
  filter: string;
  appliedFilterProfile: string;
};

export type VoiceMasteringFilterProfile = "advanced" | "compatible";

export type VoiceCleanupPreprocessResult = {
  samples: Float32Array;
  averageGateReduction: number;
  peakLevel: number;
  rmsLevel: number;
};

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const validModes: VoiceMasteringMode[] = ["off", "natural", "broadcast", "synthetic-pitch-lock", "smooth-vocal"];
const validScaleTypes: PitchCorrectionScaleType[] = ["chromatic", "major", "minor"];
const validTargetModes: PitchCorrectionTargetMode[] = ["speech-smooth", "scale"];
const pitchFrameSize = 2048;
const pitchHopSize = 512;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function clamp01(value: number | undefined, fallback = 0): number {
  return clamp(finiteOrDefault(value, fallback), 0, 1);
}

export function createDefaultVoiceMasteringSettings(): VoiceMasteringSettings {
  return {
    mode: "smooth-vocal",
    masteringStrength: 0.82,
    pitchLockAmount: 0.35,
    frequencySculptor: {
      rumbleCut: 0.72,
      warmth: 0.5,
      presence: 0.52,
      harshness: 0.35,
      deCrackle: 0.68
    },
    voiceCleanup: {
      highPassHz: 90,
      gateThresholdDb: -38,
      gateStrength: 0.72,
      deEssAmount: 0.65,
      transientSmoothing: 0.45,
      vocalLeveling: 0.72
    },
    pitchCorrection: {
      strength: 0.35,
      smoothing: 0.72,
      correctionSpeed: 0.5,
      maxCentsPerSecond: 600,
      targetMode: "speech-smooth",
      scaleKey: "C",
      scaleType: "major"
    }
  };
}

export function normalizeVoiceMasteringSettings(settings: VoiceMasteringSettings): VoiceMasteringSettings {
  const defaults = createDefaultVoiceMasteringSettings();
  const cleanup = settings.voiceCleanup ?? defaults.voiceCleanup;
  const pitchCorrection = settings.pitchCorrection ?? defaults.pitchCorrection;
  const sculptor = settings.frequencySculptor ?? defaults.frequencySculptor;
  const scaleKey = noteNames.includes(pitchCorrection.scaleKey) ? pitchCorrection.scaleKey : defaults.pitchCorrection.scaleKey;

  return {
    mode: validModes.includes(settings.mode) ? settings.mode : defaults.mode,
    masteringStrength: clamp01(settings.masteringStrength, defaults.masteringStrength),
    pitchLockAmount: clamp01(settings.pitchLockAmount, defaults.pitchLockAmount),
    frequencySculptor: {
      rumbleCut: clamp01(sculptor.rumbleCut, defaults.frequencySculptor.rumbleCut),
      warmth: clamp01(sculptor.warmth, defaults.frequencySculptor.warmth),
      presence: clamp01(sculptor.presence, defaults.frequencySculptor.presence),
      harshness: clamp01(sculptor.harshness, defaults.frequencySculptor.harshness),
      deCrackle: clamp01(sculptor.deCrackle, defaults.frequencySculptor.deCrackle)
    },
    voiceCleanup: {
      highPassHz: clamp(finiteOrDefault(cleanup.highPassHz, defaults.voiceCleanup.highPassHz), 60, 180),
      gateThresholdDb: clamp(finiteOrDefault(cleanup.gateThresholdDb, defaults.voiceCleanup.gateThresholdDb), -72, -24),
      gateStrength: clamp01(cleanup.gateStrength),
      deEssAmount: clamp01(cleanup.deEssAmount),
      transientSmoothing: clamp01(cleanup.transientSmoothing),
      vocalLeveling: clamp01(cleanup.vocalLeveling)
    },
    pitchCorrection: {
      strength: clamp01(pitchCorrection.strength),
      smoothing: clamp01(pitchCorrection.smoothing),
      correctionSpeed: clamp01(pitchCorrection.correctionSpeed),
      maxCentsPerSecond: clamp(finiteOrDefault(pitchCorrection.maxCentsPerSecond, defaults.pitchCorrection.maxCentsPerSecond), 50, 2400),
      targetMode: validTargetModes.includes(pitchCorrection.targetMode) ? pitchCorrection.targetMode : defaults.pitchCorrection.targetMode,
      scaleKey,
      scaleType: validScaleTypes.includes(pitchCorrection.scaleType) ? pitchCorrection.scaleType : defaults.pitchCorrection.scaleType
    }
  };
}

export function buildVoiceMasteringFilter(
  settings: VoiceMasteringSettings,
  profile: VoiceMasteringFilterProfile = "advanced"
): MasteringFilterResult {
  const normalized = normalizeVoiceMasteringSettings(settings);
  if (normalized.mode === "off") {
    return { filter: "anull", appliedFilterProfile: "off" };
  }

  const strength = normalized.masteringStrength;
  const sculptor = normalized.frequencySculptor;
  const cleanup = normalized.voiceCleanup;
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

  return {
    filter: filters.join(","),
    appliedFilterProfile: profile === "compatible" ? `${normalized.mode}-compatible` : normalized.mode
  };
}

export function quantizeFrequencyToNearestNote(frequencyHz: number): { frequencyHz: number; note: string } {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return { frequencyHz: 0, note: "Unvoiced" };
  const midi = Math.round(69 + 12 * Math.log2(frequencyHz / 440));
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  const note = `${noteNames[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  return { frequencyHz: frequency, note };
}

export function analyzePitchLock(samples: Float32Array, sampleRate: number, _options: PitchLockOptions): PitchLockAnalysis {
  const frameSize = 2048;
  const hopSize = 1024;
  const pitches: number[] = [];
  const confidences: number[] = [];

  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    const pitch = detectFramePitch(samples.subarray(offset, offset + frameSize), sampleRate);
    if (pitch.confidence >= 0.52) {
      pitches.push(pitch.frequencyHz);
      confidences.push(pitch.confidence);
    }
  }

  if (pitches.length === 0) {
    return { detectedMedianPitchHz: 0, targetPitchHz: 0, targetNote: "Unvoiced", confidence: 0, voicedFrameRatio: 0 };
  }

  const median = medianNumber(pitches);
  const target = quantizeFrequencyToNearestNote(median);
  const totalFrames = Math.max(1, Math.floor((samples.length - frameSize) / hopSize) + 1);

  return {
    detectedMedianPitchHz: median,
    targetPitchHz: target.frequencyHz,
    targetNote: target.note,
    confidence: medianNumber(confidences),
    voicedFrameRatio: pitches.length / totalFrames
  };
}

export function applySyntheticPitchLock(
  samples: Float32Array,
  sampleRate: number,
  settings: VoiceMasteringSettings
): { samples: Float32Array; diagnostics: VoiceRenderDiagnostics } {
  const normalized = normalizeVoiceMasteringSettings(settings);
  const analysis = analyzePitchLock(samples, sampleRate, { pitchLockAmount: normalized.pitchLockAmount });
  const clippingCount = countClippedSamples(samples);
  const peakLevel = getPeakLevel(samples);

  if (normalized.mode !== "synthetic-pitch-lock" || analysis.targetPitchHz <= 0 || normalized.pitchLockAmount <= 0) {
    return {
      samples: new Float32Array(samples),
      diagnostics: buildDiagnostics(normalized.mode, analysis, [], 0, 0, samples, sampleRate, normalized.mode)
    };
  }

  const amount = normalized.pitchLockAmount;
  const output = new Float32Array(samples.length);
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
    diagnostics: {
      ...buildDiagnostics("synthetic-pitch-lock", analysis, [], 0, 0, output, sampleRate, "synthetic-pitch-lock"),
      clippingCount,
      peakLevel: getPeakLevel(output)
    }
  };
}

export function applyVoiceCleanupPreprocess(
  samples: Float32Array,
  sampleRate: number,
  settings: VoiceCleanupSettings
): VoiceCleanupPreprocessResult {
  const cleanup = normalizeVoiceMasteringSettings({
    ...createDefaultVoiceMasteringSettings(),
    voiceCleanup: settings
  }).voiceCleanup;
  let output = removeDcOffset(samples);
  output = applyHighPass(output, sampleRate, cleanup.highPassHz);
  const gated = applyLookaheadGate(output, sampleRate, cleanup);
  output = applyDeEsser(gated.samples, sampleRate, cleanup.deEssAmount);
  output = applyTransientSmoothing(output, cleanup.transientSmoothing);
  output = applyVocalLeveling(output, sampleRate, cleanup.vocalLeveling);
  output = limitSamples(output);

  return {
    samples: output,
    averageGateReduction: gated.averageReduction,
    peakLevel: getPeakLevel(output),
    rmsLevel: getRmsLevel(output)
  };
}

export function analyzeVocalPitchFrames(
  samples: Float32Array,
  sampleRate: number,
  settings: PitchCorrectionSettings
): PitchDiagnosticFrame[] {
  const frames: PitchDiagnosticFrame[] = [];
  const normalized = normalizeVoiceMasteringSettings({
    ...createDefaultVoiceMasteringSettings(),
    pitchCorrection: settings
  }).pitchCorrection;

  for (let offset = 0; offset + pitchFrameSize <= samples.length; offset += pitchHopSize) {
    const frame = samples.subarray(offset, offset + pitchFrameSize);
    const pitch = detectFramePitchYin(frame, sampleRate);
    frames.push({
      timeSeconds: offset / sampleRate,
      rawPitchHz: pitch.frequencyHz,
      smoothedPitchHz: pitch.frequencyHz,
      targetPitchHz: pitch.frequencyHz,
      correctionCents: 0,
      voiced: pitch.voiced,
      confidence: pitch.confidence,
      gateReduction: 0
    });
  }

  return smoothPitchFrames(frames, normalized);
}

export function smoothPitchFrames(frames: PitchDiagnosticFrame[], settings: PitchCorrectionSettings): PitchDiagnosticFrame[] {
  const normalized = normalizeVoiceMasteringSettings({
    ...createDefaultVoiceMasteringSettings(),
    pitchCorrection: settings
  }).pitchCorrection;
  let previousSmoothed = 0;
  let previousTime = 0;

  return frames.map((frame, index) => {
    if (!frame.voiced || frame.rawPitchHz <= 0) {
      return { ...frame, smoothedPitchHz: 0, targetPitchHz: 0, correctionCents: 0 };
    }

    const neighborhood = frames
      .slice(Math.max(0, index - 2), Math.min(frames.length, index + 3))
      .filter((candidate) => candidate.voiced && candidate.rawPitchHz > 0)
      .map((candidate) => candidate.rawPitchHz);
    const medianPitch = neighborhood.length > 0 ? medianNumber(neighborhood) : frame.rawPitchHz;
    const alpha = clamp(1 - normalized.smoothing * 0.85, 0.08, 1);
    let smoothed = previousSmoothed > 0 ? previousSmoothed + (medianPitch - previousSmoothed) * alpha : medianPitch;

    if (previousSmoothed > 0) {
      const deltaSeconds = Math.max(1 / 120, frame.timeSeconds - previousTime);
      const maxCents = normalized.maxCentsPerSecond * deltaSeconds * (0.45 + normalized.correctionSpeed * 0.55);
      const maxRatio = 2 ** (maxCents / 1200);
      smoothed = clamp(smoothed, previousSmoothed / maxRatio, previousSmoothed * maxRatio);
    }

    previousSmoothed = smoothed;
    previousTime = frame.timeSeconds;

    const scaleTarget =
      normalized.targetMode === "scale" ? quantizeFrequencyToScale(smoothed, normalized.scaleKey, normalized.scaleType) : smoothed;
    const rawCorrection = 1200 * Math.log2(scaleTarget / frame.rawPitchHz);
    const correctionLimit = 120 * normalized.strength * (0.45 + normalized.correctionSpeed * 0.55);
    const correctionCents = clamp(rawCorrection * normalized.strength, -correctionLimit, correctionLimit);
    const targetPitchHz = frame.rawPitchHz * 2 ** (correctionCents / 1200);

    return {
      ...frame,
      smoothedPitchHz: smoothed,
      targetPitchHz,
      correctionCents
    };
  });
}

export function applySmoothVocalMastering(
  samples: Float32Array,
  sampleRate: number,
  settings: VoiceMasteringSettings
): { samples: Float32Array; diagnostics: VoiceRenderDiagnostics } {
  const normalized = normalizeVoiceMasteringSettings(settings);
  if (normalized.mode === "off") {
    const analysis = analyzePitchLock(samples, sampleRate, { pitchLockAmount: 0 });
    return {
      samples: new Float32Array(samples),
      diagnostics: buildDiagnostics("off", analysis, [], 0, 0, samples, sampleRate, "off")
    };
  }

  const cleaned = applyVoiceCleanupPreprocess(samples, sampleRate, normalized.voiceCleanup);
  const pitchTrace = analyzeVocalPitchFrames(cleaned.samples, sampleRate, normalized.pitchCorrection).map((frame) => ({
    ...frame,
    gateReduction: cleaned.averageGateReduction
  }));
  const corrected = applyNaturalPitchCorrection(cleaned.samples, sampleRate, pitchTrace, normalized.pitchCorrection);
  const voicedFrames = pitchTrace.filter((frame) => frame.voiced);
  const medianRaw = voicedFrames.length > 0 ? medianNumber(voicedFrames.map((frame) => frame.rawPitchHz)) : 0;
  const medianSmoothed = voicedFrames.length > 0 ? medianNumber(voicedFrames.map((frame) => frame.smoothedPitchHz)) : 0;
  const analysis: PitchLockAnalysis = {
    detectedMedianPitchHz: medianRaw,
    targetPitchHz: medianSmoothed,
    targetNote: quantizeFrequencyToNearestNote(medianSmoothed).note,
    confidence: voicedFrames.length > 0 ? medianNumber(voicedFrames.map((frame) => frame.confidence)) : 0,
    voicedFrameRatio: pitchTrace.length > 0 ? voicedFrames.length / pitchTrace.length : 0
  };

  return {
    samples: corrected,
    diagnostics: buildDiagnostics(
      normalized.mode,
      analysis,
      pitchTrace,
      cleaned.averageGateReduction,
      estimateGainReductionDb(samples, corrected),
      corrected,
      sampleRate,
      "smooth-vocal"
    )
  };
}

export function decodePcm16Wav(bytes: Uint8Array): { sampleRate: number; samples: Float32Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    throw new Error("Expected a RIFF/WAVE PCM file.");
  }

  let offset = 12;
  let sampleRate = 48_000;
  let channels = 1;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const chunkData = offset + 8;

    if (chunkId === "fmt ") {
      channels = view.getUint16(chunkData + 2, true);
      sampleRate = view.getUint32(chunkData + 4, true);
      bitsPerSample = view.getUint16(chunkData + 14, true);
    } else if (chunkId === "data") {
      dataOffset = chunkData;
      dataLength = chunkLength;
      break;
    }

    offset = chunkData + chunkLength + (chunkLength % 2);
  }

  if (dataOffset < 0 || bitsPerSample !== 16) {
    throw new Error("Only PCM 16-bit WAV audio is supported.");
  }

  const frameCount = Math.floor(dataLength / 2 / channels);
  const samples = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const sampleOffset = dataOffset + (frame * channels + channel) * 2;
      sum += view.getInt16(sampleOffset, true) / 32768;
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
    const filtered = alpha * (previousOutput + current - previousInput);
    output[index] = filtered;
    previousInput = current;
    previousOutput = filtered;
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
  const threshold = dbToLinear(settings.gateThresholdDb);
  const openThreshold = threshold * (2.8 + settings.gateStrength);
  const attack = Math.exp(-1 / (sampleRate * 0.006));
  const release = Math.exp(-1 / (sampleRate * 0.09));
  let envelope = 0;
  let gain = 1;
  let reductionSum = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const level = Math.abs(samples[index]);
    const coefficient = level > envelope ? attack : release;
    envelope = coefficient * envelope + (1 - coefficient) * level;
    const openness = clamp(envelope / Math.max(openThreshold, 1e-6), 0, 1);
    const targetGain = clamp(1 - settings.gateStrength * 1.18 * (1 - openness), 0.12, 1);
    const gainCoefficient = targetGain < gain ? 0.22 : 0.012;
    gain += (targetGain - gain) * gainCoefficient;
    output[index] = samples[index] * gain;
    reductionSum += 1 - gain;
  }

  return { samples: output, averageReduction: reductionSum / Math.max(1, samples.length) };
}

function applyDeEsser(samples: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount <= 0) return new Float32Array(samples);
  const output = new Float32Array(samples.length);
  const lowpassCutoff = 3200;
  const rc = 1 / (2 * Math.PI * lowpassCutoff);
  const alpha = (1 / sampleRate) / (rc + 1 / sampleRate);
  let low = 0;
  let broadbandEnvelope = 0;
  let highEnvelope = 0;

  for (let index = 0; index < samples.length; index += 1) {
    low += alpha * (samples[index] - low);
    const high = samples[index] - low;
    broadbandEnvelope += (Math.abs(samples[index]) - broadbandEnvelope) * 0.008;
    highEnvelope += (Math.abs(high) - highEnvelope) * 0.025;
    const sibilanceRatio = highEnvelope / Math.max(broadbandEnvelope, 1e-5);
    const reduction = amount * clamp((sibilanceRatio - 0.1) / 0.55, 0, 0.995);
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
    const softened = Math.tanh(slewed * (1 + amount * 0.6)) / Math.tanh(1 + amount * 0.6);
    output[index] = clamp(softened, -0.98, 0.98);
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
    const coefficient = level > envelope ? attack : release;
    envelope = coefficient * envelope + (1 - coefficient) * level;
    const desiredGain =
      envelope < 0.035 ? Math.min(1, clamp(target / Math.max(envelope, 0.012), 0.45, 2.8)) : clamp(target / Math.max(envelope, 0.012), 0.45, 2.8);
    gain += (desiredGain - gain) * (0.002 + amount * 0.004);
    output[index] = samples[index] * (1 + (gain - 1) * amount);
  }

  return output;
}

function limitSamples(samples: Float32Array): Float32Array {
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    output[index] = clamp(samples[index], -0.98, 0.98);
  }
  return output;
}

function detectFramePitchYin(frame: Float32Array, sampleRate: number): { frequencyHz: number; confidence: number; voiced: boolean } {
  const rms = getRmsLevel(frame);
  if (rms < 0.012) return { frequencyHz: 0, confidence: 0, voiced: false };

  const minLag = Math.floor(sampleRate / 360);
  const maxLag = Math.floor(sampleRate / 70);
  const difference = new Float32Array(maxLag + 1);

  for (let lag = 1; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let index = 0; index + lag < frame.length; index += 1) {
      const delta = frame[index] - frame[index + lag];
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  let runningSum = 0;

  for (let lag = 1; lag <= maxLag; lag += 1) {
    runningSum += difference[lag];
    const normalized = runningSum > 0 ? (difference[lag] * lag) / runningSum : 1;
    difference[lag] = normalized;
  }

  let bestLag = 0;
  let bestValue = Number.POSITIVE_INFINITY;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const normalized = difference[lag];
    if (normalized < bestValue) {
      bestValue = normalized;
      bestLag = lag;
    }
    if (normalized < 0.14 && normalized <= difference[Math.max(minLag, lag - 1)] && normalized <= difference[Math.min(maxLag, lag + 1)]) {
      bestLag = lag;
      bestValue = normalized;
      break;
    }
  }

  if (bestLag <= 0 || bestValue > 0.38) return { frequencyHz: 0, confidence: 0, voiced: false };
  const refinedLag = refineYinLag(difference, bestLag, minLag, maxLag);
  const frequencyHz = sampleRate / refinedLag;
  const confidence = clamp(1 - bestValue, 0, 1);
  return { frequencyHz, confidence, voiced: frequencyHz >= 70 && frequencyHz <= 360 && confidence >= 0.62 };
}

function refineYinLag(difference: Float32Array, bestLag: number, minLag: number, maxLag: number): number {
  if (bestLag <= minLag || bestLag >= maxLag) return bestLag;
  const left = difference[bestLag - 1];
  const center = difference[bestLag];
  const right = difference[bestLag + 1];
  const denominator = left - 2 * center + right;
  if (Math.abs(denominator) < 1e-9) return bestLag;
  return clamp(bestLag + 0.5 * ((left - right) / denominator), minLag, maxLag);
}

function applyNaturalPitchCorrection(
  samples: Float32Array,
  sampleRate: number,
  frames: PitchDiagnosticFrame[],
  settings: PitchCorrectionSettings
): Float32Array {
  const strength = clamp01(settings.strength, 0);
  if (strength <= 0 || frames.every((frame) => !frame.voiced || Math.abs(frame.correctionCents) < 0.1)) {
    return limitSamples(samples);
  }

  const frameSize = pitchFrameSize;
  const halfFrame = frameSize / 2;
  const accumulated = new Float32Array(samples.length);
  const weights = new Float32Array(samples.length);
  const blend = strength * 0.45;

  frames.forEach((frame) => {
    const start = Math.round(frame.timeSeconds * sampleRate);
    const ratio = frame.voiced ? 2 ** (frame.correctionCents / 1200) : 1;
    for (let local = 0; local < frameSize; local += 1) {
      const outputIndex = start + local;
      if (outputIndex < 0 || outputIndex >= samples.length) continue;
      const sourcePosition = start + halfFrame + (local - halfFrame) * ratio;
      const shifted = interpolateSample(samples, sourcePosition);
      const dry = samples[outputIndex];
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * local) / Math.max(1, frameSize - 1));
      accumulated[outputIndex] += (dry * (1 - blend) + shifted * blend) * window;
      weights[outputIndex] += window;
    }
  });

  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    output[index] = weights[index] > 0 ? accumulated[index] / weights[index] : samples[index];
  }
  return limitSamples(output);
}

function interpolateSample(samples: Float32Array, position: number): number {
  const leftIndex = Math.floor(position);
  const rightIndex = leftIndex + 1;
  if (leftIndex < 0 || rightIndex >= samples.length) return 0;
  const fraction = position - leftIndex;
  return samples[leftIndex] * (1 - fraction) + samples[rightIndex] * fraction;
}

function quantizeFrequencyToScale(frequencyHz: number, key: string, scaleType: PitchCorrectionScaleType): number {
  if (scaleType === "chromatic") return quantizeFrequencyToNearestNote(frequencyHz).frequencyHz;
  const keyIndex = Math.max(0, noteNames.indexOf(key));
  const allowed = scaleType === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const midi = 69 + 12 * Math.log2(frequencyHz / 440);
  let bestMidi = Math.round(midi);
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let candidate = Math.floor(midi) - 12; candidate <= Math.ceil(midi) + 12; candidate += 1) {
    const degree = (((candidate - keyIndex) % 12) + 12) % 12;
    if (!allowed.includes(degree)) continue;
    const distance = Math.abs(candidate - midi);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMidi = candidate;
    }
  }

  return 440 * 2 ** ((bestMidi - 69) / 12);
}

function buildDiagnostics(
  mode: VoiceMasteringMode,
  analysis: PitchLockAnalysis,
  pitchTrace: PitchDiagnosticFrame[],
  gateActivity: number,
  gainReductionDb: number,
  samples: Float32Array,
  sampleRate: number,
  appliedFilterProfile: string
): VoiceRenderDiagnostics {
  const voicedFrames = pitchTrace.filter((frame) => frame.voiced);
  return {
    mode,
    targetPitchHz: analysis.targetPitchHz,
    voicedFrameConfidence: analysis.confidence,
    clippingCount: countClippedSamples(samples),
    peakLevel: getPeakLevel(samples),
    rmsLevel: getRmsLevel(samples),
    sampleRate,
    appliedFilterProfile,
    rawPitchHz: analysis.detectedMedianPitchHz,
    smoothedPitchHz: voicedFrames.length > 0 ? medianNumber(voicedFrames.map((frame) => frame.smoothedPitchHz)) : analysis.targetPitchHz,
    voicedFrameRatio: analysis.voicedFrameRatio,
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
  for (let index = 0; index < 48; index += 1) {
    compact.push(frames[Math.min(frames.length - 1, Math.floor(index * step))]);
  }
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

function detectFramePitch(frame: Float32Array, sampleRate: number): { frequencyHz: number; confidence: number } {
  const minLag = Math.floor(sampleRate / 360);
  const maxLag = Math.floor(sampleRate / 70);
  let frameEnergy = 0;
  for (const sample of frame) frameEnergy += sample * sample;
  if (frameEnergy / frame.length < 0.00001) return { frequencyHz: 0, confidence: 0 };

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

  return {
    frequencyHz: refinedLag > 0 ? sampleRate / refinedLag : 0,
    confidence: clamp(bestCorrelation, 0, 1)
  };
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

function medianNumber(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle] ?? 0;
}

function countClippedSamples(samples: Float32Array): number {
  let count = 0;
  for (const sample of samples) {
    if (Math.abs(sample) >= 0.98) count += 1;
  }
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

function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}
