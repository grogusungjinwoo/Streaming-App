import { describe, expect, it } from "vitest";
import { buildFfmpegRenderArgs, clampRenderTrimRange, getRecordedAudioProcessingMode } from "./mp4RenderService";
import {
  analyzePitchLock,
  buildVoiceMasteringFilter,
  createDefaultVoiceMasteringSettings,
  quantizeFrequencyToNearestNote
} from "./voiceMasteringService";

describe("mp4RenderService", () => {
  it("clamps render trim ranges to the recording duration", () => {
    expect(clampRenderTrimRange({ start: -3, end: 90 }, 60)).toEqual({ start: 0, end: 60 });
    expect(clampRenderTrimRange({ start: 58, end: 12 }, 60)).toEqual({ start: 58, end: 60 });
  });

  it("builds ffmpeg args for trimmed H.264/AAC MP4 review output", () => {
    const args = buildFfmpegRenderArgs({
      inputPath: "input.webm",
      outputPath: "review.mp4",
      trimRange: { start: 2, end: 8 },
      frameRate: 60,
      videoBitsPerSecond: 9_000_000,
      voicePatchStrength: 0.7,
      perfectPopStrength: 0,
      audioProcessingMode: "mastered",
      voiceMastering: createDefaultVoiceMasteringSettings()
    });

    expect(args).toEqual(
      expect.arrayContaining([
        "-i",
        "input.webm",
        "-ss",
        "2",
        "-t",
        "6",
        "-r",
        "60",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart"
      ])
    );
    expect(args[args.length - 1]).toBe("review.mp4");
    expect(args[args.indexOf("-b:v") + 1]).toBe("9000k");
  });

  it("builds native audio render args without app audio filters or forced resampling", () => {
    const args = buildFfmpegRenderArgs({
      inputPath: "input.webm",
      outputPath: "review.mp4",
      trimRange: { start: 0, end: 10 },
      frameRate: 30,
      videoBitsPerSecond: 6_000_000,
      voicePatchStrength: 0.7,
      perfectPopStrength: 0,
      audioProcessingMode: "native",
      voiceMastering: createDefaultVoiceMasteringSettings()
    });

    expect(args).toEqual(expect.arrayContaining(["-c:a", "aac", "-b:a", "192k"]));
    expect(args).not.toContain("-af");
    expect(args).not.toContain("-ar");
    expect(args.join(" ")).not.toContain("aformat");
    expect(args.join(" ")).not.toContain("aresample");
    expect(args.join(" ")).not.toContain("highpass");
    expect(args.join(" ")).not.toContain("acompressor");
    expect(args.join(" ")).not.toContain("alimiter");
  });

  it("uses the recorded capture profile when choosing render audio processing", () => {
    expect(getRecordedAudioProcessingMode("device-native", "browser-cleanup")).toBe("native");
    expect(getRecordedAudioProcessingMode("browser-cleanup", "device-native")).toBe("mastered");
    expect(getRecordedAudioProcessingMode(null, "device-native")).toBe("native");
  });

  it("builds a conservative voice mastering filter for synthetic pitch lock renders", () => {
    const result = buildVoiceMasteringFilter({
      ...createDefaultVoiceMasteringSettings(),
      mode: "synthetic-pitch-lock",
      masteringStrength: 0.8,
      pitchLockAmount: 0.85
    });

    expect(result.filter).toContain("aformat=sample_fmts=fltp:sample_rates=48000");
    expect(result.filter).toContain("aresample=48000");
    expect(result.filter).toContain("adeclick");
    expect(result.filter).toContain("adeclip");
    expect(result.filter).toContain("afftdn");
    expect(result.filter).toContain("dynaudnorm");
    expect(result.filter).toContain("mcompand=0.008\\,0.060 6 -70/-70\\,-45/-36");
    expect(result.filter).toContain("alimiter");
    expect(result.filter).not.toContain("rubberband");
    expect(result.filter).not.toContain("mcompand=0.008,0.060");
    expect(result.filter).not.toContain("-70/-70,-45/-36");
  });

  it("builds a compatible fallback chain without advanced repair filters", () => {
    const result = buildVoiceMasteringFilter(createDefaultVoiceMasteringSettings(), "compatible");

    expect(result.appliedFilterProfile).toBe("smooth-vocal-compatible");
    expect(result.filter).toContain("highpass");
    expect(result.filter).toContain("afftdn");
    expect(result.filter).toContain("acompressor");
    expect(result.filter).toContain("alimiter");
    expect(result.filter).not.toContain("adeclick");
    expect(result.filter).not.toContain("dynaudnorm");
  });

  it("quantizes detected pitch to a stable musical target", () => {
    expect(quantizeFrequencyToNearestNote(221)).toEqual(
      expect.objectContaining({ note: "A3", frequencyHz: expect.closeTo(220, 1) })
    );
  });

  it("detects a confident voiced pitch target from synthetic audio", () => {
    const sampleRate = 48_000;
    const samples = Float32Array.from({ length: sampleRate }, (_, index) => Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 0.35);
    const analysis = analyzePitchLock(samples, sampleRate, { pitchLockAmount: 0.85 });

    expect(analysis.detectedMedianPitchHz).toBeCloseTo(220, 4);
    expect(analysis.targetPitchHz).toBeCloseTo(220, 1);
    expect(analysis.voicedFrameRatio).toBeGreaterThan(0.8);
    expect(analysis.confidence).toBeGreaterThan(0.75);
  });
});
