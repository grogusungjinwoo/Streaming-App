import { describe, expect, it } from "vitest";
import { buildCaptureConstraints, capturePresets, getVideoBitsPerSecond } from "./deviceService";

describe("deviceService", () => {
  it("uses the selected frame rate and voice-clean microphone constraints by default", () => {
    const constraints = buildCaptureConstraints(capturePresets[0], 60, "camera-1", "mic-1");
    const video = constraints.video as MediaTrackConstraints;
    const audio = constraints.audio as MediaTrackConstraints;

    expect(video.frameRate).toEqual({ ideal: 60 });
    expect(video.deviceId).toEqual({ exact: "camera-1" });
    expect(audio.deviceId).toEqual({ exact: "mic-1" });
    expect(audio.sampleRate).toEqual({ ideal: 48_000 });
    expect(audio.channelCount).toEqual({ ideal: 1 });
    expect(audio.echoCancellation).toBe(true);
    expect(audio.noiseSuppression).toBe(true);
    expect(audio.autoGainControl).toBe(true);
  });

  it("can request studio raw capture when the user wants unprocessed microphone input", () => {
    const constraints = buildCaptureConstraints(capturePresets[0], 30, "camera-1", "mic-1", "studio-raw");
    const audio = constraints.audio as MediaTrackConstraints;

    expect(audio.noiseSuppression).toBe(false);
    expect(audio.autoGainControl).toBe(false);
    expect(audio.echoCancellation).toBe(false);
  });

  it("keeps 30 fps at the preset bitrate and scales 60 fps upward", () => {
    const preset = capturePresets[0];

    expect(getVideoBitsPerSecond(preset, 30)).toBe(preset.videoBitsPerSecond);
    expect(getVideoBitsPerSecond(preset, 60)).toBe(Math.round(preset.videoBitsPerSecond * 1.5));
  });
});
