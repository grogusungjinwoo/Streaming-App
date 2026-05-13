import { describe, expect, it } from "vitest";
import {
  applySyntheticPitchLock,
  createDefaultVoiceMasteringSettings,
  decodePcm16Wav,
  encodePcm16Wav
} from "./voiceMasteringService";

describe("voiceMasteringService", () => {
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
});
