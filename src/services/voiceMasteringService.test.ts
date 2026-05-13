import { describe, expect, it } from "vitest";
import * as voiceMastering from "./voiceMasteringService";
import {
  applySyntheticPitchLock,
  createDefaultVoiceMasteringSettings,
  decodePcm16Wav,
  encodePcm16Wav,
  normalizeVoiceMasteringSettings
} from "./voiceMasteringService";

type CleanupResult = {
  samples: Float32Array;
  averageGateReduction: number;
  peakLevel: number;
  rmsLevel: number;
};

type PitchFrame = {
  timeSeconds: number;
  rawPitchHz: number;
  smoothedPitchHz: number;
  targetPitchHz: number;
  correctionCents: number;
  voiced: boolean;
  confidence: number;
  gateReduction: number;
};

type NaturalCleanupApi = {
  applyVoiceCleanupPreprocess: (
    samples: Float32Array,
    sampleRate: number,
    settings: ReturnType<typeof createDefaultVoiceMasteringSettings>["voiceCleanup"]
  ) => CleanupResult;
  analyzeVocalPitchFrames: (
    samples: Float32Array,
    sampleRate: number,
    settings: ReturnType<typeof createDefaultVoiceMasteringSettings>["pitchCorrection"]
  ) => PitchFrame[];
  smoothPitchFrames: (
    frames: PitchFrame[],
    settings: ReturnType<typeof createDefaultVoiceMasteringSettings>["pitchCorrection"]
  ) => PitchFrame[];
  applySmoothVocalMastering: (
    samples: Float32Array,
    sampleRate: number,
    settings: ReturnType<typeof createDefaultVoiceMasteringSettings>
  ) => { samples: Float32Array; diagnostics: { pitchTrace: PitchFrame[]; gateActivity: number; rmsLevel: number; peakLevel: number } };
};

const naturalCleanupApi = voiceMastering as unknown as NaturalCleanupApi;

describe("voiceMasteringService", () => {
  it("defaults to smooth vocal cleanup with conservative speech pitch smoothing", () => {
    const settings = createDefaultVoiceMasteringSettings();

    expect(settings.mode).toBe("smooth-vocal");
    expect(settings.voiceCleanup.highPassHz).toBe(90);
    expect(settings.voiceCleanup.gateThresholdDb).toBeLessThan(-35);
    expect(settings.voiceCleanup.deEssAmount).toBeGreaterThan(0.4);
    expect(settings.pitchCorrection.targetMode).toBe("speech-smooth");
    expect(settings.pitchCorrection.strength).toBeGreaterThan(0);
    expect(settings.pitchCorrection.strength).toBeLessThan(0.6);
  });

  it("normalizes nested voice cleanup and pitch correction settings into safe ranges", () => {
    const normalized = normalizeVoiceMasteringSettings({
      ...createDefaultVoiceMasteringSettings(),
      voiceCleanup: {
        highPassHz: 10,
        gateThresholdDb: -4,
        gateStrength: 8,
        deEssAmount: -3,
        transientSmoothing: 2,
        vocalLeveling: Number.NaN
      },
      pitchCorrection: {
        strength: 3,
        smoothing: -1,
        correctionSpeed: 4,
        maxCentsPerSecond: 80_000,
        targetMode: "speech-smooth",
        scaleKey: "H",
        scaleType: "major"
      }
    });

    expect(normalized.voiceCleanup).toEqual({
      highPassHz: 60,
      gateThresholdDb: -24,
      gateStrength: 1,
      deEssAmount: 0,
      transientSmoothing: 1,
      vocalLeveling: 0
    });
    expect(normalized.pitchCorrection).toEqual({
      strength: 1,
      smoothing: 0,
      correctionSpeed: 1,
      maxCentsPerSecond: 2400,
      targetMode: "speech-smooth",
      scaleKey: "C",
      scaleType: "major"
    });
  });

  it("round-trips mono PCM wav samples at 48 kHz", () => {
    const samples = Float32Array.from([0, 0.25, -0.25, 0.75, -0.75]);
    const wav = encodePcm16Wav(samples, 48_000);
    const decoded = decodePcm16Wav(wav);

    expect(decoded.sampleRate).toBe(48_000);
    expect(decoded.samples.length).toBe(samples.length);
    expect(decoded.samples[1]).toBeCloseTo(0.25, 3);
    expect(decoded.samples[4]).toBeCloseTo(-0.75, 3);
  });

  it("resynthesizes voiced frames toward one synthetic pitch while preserving amplitude", () => {
    const sampleRate = 48_000;
    const samples = Float32Array.from({ length: sampleRate }, (_, index) => {
      const fade = 0.15 + 0.35 * (index / sampleRate);
      return Math.sin((2 * Math.PI * 205 * index) / sampleRate) * fade;
    });
    const result = applySyntheticPitchLock(samples, sampleRate, {
      ...createDefaultVoiceMasteringSettings(),
      mode: "synthetic-pitch-lock",
      pitchLockAmount: 1
    });

    expect(result.diagnostics.mode).toBe("synthetic-pitch-lock");
    expect(result.diagnostics.targetPitchHz).toBeGreaterThan(190);
    expect(result.diagnostics.targetPitchHz).toBeLessThan(230);
    expect(result.diagnostics.voicedFrameConfidence).toBeGreaterThan(0.7);
    expect(Math.max(...result.samples)).toBeLessThanOrEqual(0.98);
  });

  it("suppresses low-level room noise while preserving voiced speech energy", () => {
    const sampleRate = 48_000;
    const settings = createDefaultVoiceMasteringSettings();
    const samples = Float32Array.from({ length: sampleRate }, (_, index) => {
      if (index < sampleRate * 0.25) return Math.sin((2 * Math.PI * 1200 * index) / sampleRate) * 0.018;
      const voice = Math.sin((2 * Math.PI * 180 * index) / sampleRate) * 0.22;
      const noise = Math.sin((2 * Math.PI * 1700 * index) / sampleRate) * 0.018;
      return voice + noise;
    });

    const cleaned = naturalCleanupApi.applyVoiceCleanupPreprocess(samples, sampleRate, settings.voiceCleanup);
    const originalNoiseRms = rms(samples.subarray(0, sampleRate * 0.25));
    const cleanedNoiseRms = rms(cleaned.samples.subarray(0, sampleRate * 0.25));
    const cleanedVoiceRms = rms(cleaned.samples.subarray(sampleRate * 0.5, sampleRate * 0.75));

    expect(cleanedNoiseRms).toBeLessThan(originalNoiseRms * 0.65);
    expect(cleanedVoiceRms).toBeGreaterThan(0.08);
    expect(cleaned.averageGateReduction).toBeGreaterThan(0.05);
  });

  it("de-esses sibilant bursts without crushing the lower vocal band", () => {
    const sampleRate = 48_000;
    const baseVoice = Float32Array.from({ length: sampleRate / 2 }, (_, index) => {
      const vocal = Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 0.16;
      const sibilance = index > 6000 && index < 10_000 ? Math.sin((2 * Math.PI * 6500 * index) / sampleRate) * 0.22 : 0;
      return vocal + sibilance;
    });
    const settings = { ...createDefaultVoiceMasteringSettings().voiceCleanup, gateStrength: 0, deEssAmount: 1 };

    const cleaned = naturalCleanupApi.applyVoiceCleanupPreprocess(baseVoice, sampleRate, settings);

    expect(bandEnergy(cleaned.samples, sampleRate, 5200, 7600)).toBeLessThan(bandEnergy(baseVoice, sampleRate, 5200, 7600) * 0.72);
    expect(bandEnergy(cleaned.samples, sampleRate, 150, 350)).toBeGreaterThan(bandEnergy(baseVoice, sampleRate, 150, 350) * 0.72);
  });

  it("detects voiced pitch with overlap and rejects unvoiced noise", () => {
    const sampleRate = 48_000;
    const samples = Float32Array.from({ length: sampleRate }, (_, index) => {
      if (index < sampleRate / 2) return Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 0.3;
      return Math.sin((2 * Math.PI * 3800 * index) / sampleRate) * 0.015;
    });

    const frames = naturalCleanupApi.analyzeVocalPitchFrames(samples, sampleRate, createDefaultVoiceMasteringSettings().pitchCorrection);
    const voicedFrames = frames.filter((frame) => frame.voiced);
    const unvoicedFrames = frames.filter((frame) => !frame.voiced);

    expect(voicedFrames.length).toBeGreaterThan(20);
    expect(median(voicedFrames.map((frame) => frame.rawPitchHz))).toBeCloseTo(220, 1);
    expect(unvoicedFrames.length).toBeGreaterThan(5);
  });

  it("smooths pitch spikes and limits correction speed", () => {
    const settings = {
      ...createDefaultVoiceMasteringSettings().pitchCorrection,
      smoothing: 0.85,
      maxCentsPerSecond: 300
    };
    const frames: PitchFrame[] = [
      makePitchFrame(0, 200),
      makePitchFrame(0.02, 202),
      makePitchFrame(0.04, 390),
      makePitchFrame(0.06, 204),
      makePitchFrame(0.08, 205)
    ];

    const smoothed = naturalCleanupApi.smoothPitchFrames(frames, settings);

    expect(smoothed[2].smoothedPitchHz).toBeLessThan(230);
    expect(Math.abs(smoothed[4].correctionCents)).toBeLessThanOrEqual(30);
  });

  it("applies smooth vocal mastering without changing duration or clipping", () => {
    const sampleRate = 48_000;
    const samples = Float32Array.from({ length: sampleRate }, (_, index) => {
      const pitch = index < sampleRate / 2 ? 205 : 245;
      const voice = Math.sin((2 * Math.PI * pitch * index) / sampleRate) * 0.24;
      const hiss = Math.sin((2 * Math.PI * 6100 * index) / sampleRate) * 0.025;
      return voice + hiss;
    });
    const settings = {
      ...createDefaultVoiceMasteringSettings(),
      pitchCorrection: { ...createDefaultVoiceMasteringSettings().pitchCorrection, strength: 0.5, smoothing: 0.7 }
    };

    const mastered = naturalCleanupApi.applySmoothVocalMastering(samples, sampleRate, settings);

    expect(mastered.samples.length).toBe(samples.length);
    expect(Math.max(...mastered.samples.map(Math.abs))).toBeLessThanOrEqual(0.98);
    expect(mastered.diagnostics.pitchTrace.some((frame) => frame.voiced)).toBe(true);
    expect(mastered.diagnostics.rmsLevel).toBeGreaterThan(0.08);
  });
});

function rms(samples: Float32Array): number {
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  return Math.sqrt(sumSquares / Math.max(1, samples.length));
}

function bandEnergy(samples: Float32Array, sampleRate: number, lowHz: number, highHz: number): number {
  let sineEnergy = 0;
  let cosineEnergy = 0;
  const centerHz = (lowHz + highHz) / 2;
  for (let index = 0; index < samples.length; index += 1) {
    const phase = (2 * Math.PI * centerHz * index) / sampleRate;
    sineEnergy += samples[index] * Math.sin(phase);
    cosineEnergy += samples[index] * Math.cos(phase);
  }
  return Math.sqrt(sineEnergy * sineEnergy + cosineEnergy * cosineEnergy) / samples.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function makePitchFrame(timeSeconds: number, pitchHz: number): PitchFrame {
  return {
    timeSeconds,
    rawPitchHz: pitchHz,
    smoothedPitchHz: pitchHz,
    targetPitchHz: pitchHz,
    correctionCents: 0,
    voiced: true,
    confidence: 0.9,
    gateReduction: 0
  };
}
