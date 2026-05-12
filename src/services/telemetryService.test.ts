import { describe, expect, it } from "vitest";
import {
  calculateAudioTelemetry,
  calculateEstimatedFps,
  describeStreamSettings,
  estimateFileGrowth
} from "./telemetryService";

describe("telemetry service", () => {
  it("calculates RMS, peak, noise floor, and clipping from audio samples", () => {
    const telemetry = calculateAudioTelemetry(new Float32Array([0.1, -0.25, 0.96, -0.05]));

    expect(telemetry.peak).toBeCloseTo(0.96, 2);
    expect(telemetry.rms).toBeGreaterThan(0.4);
    expect(telemetry.noiseFloor).toBeCloseTo(0.05, 2);
    expect(telemetry.isClipping).toBe(true);
  });

  it("estimates FPS from frame timestamps", () => {
    expect(calculateEstimatedFps([0, 33.3, 66.6, 99.9])).toBeCloseTo(30, 0);
  });

  it("estimates file growth from elapsed time and bitrate", () => {
    expect(estimateFileGrowth(10, 4_000_000)).toBe(5_000_000);
  });

  it("reports requested versus actual stream settings", () => {
    const settings = describeStreamSettings(
      { width: 1920, height: 1080, frameRate: 60 },
      { width: 1280, height: 720, frameRate: 30 }
    );

    expect(settings).toEqual({
      requested: "1920x1080 @ 60 fps",
      actual: "1280x720 @ 30 fps"
    });
  });
});

