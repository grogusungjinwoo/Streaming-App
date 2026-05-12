import { describe, expect, it } from "vitest";
import { buildAudioPatchFilter, buildFfmpegRenderArgs, clampRenderTrimRange } from "./mp4RenderService";

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
      voicePatchStrength: 0.7
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

  it("scales the broadcast voice filter by AutoPatch strength", () => {
    expect(buildAudioPatchFilter(0)).toBe("anull");

    const filter = buildAudioPatchFilter(0.75);

    expect(filter).toContain("highpass=f=85");
    expect(filter).toContain("afftdn");
    expect(filter).toContain("acompressor");
    expect(filter).toContain("alimiter");
  });
});
