import { describe, expect, it, vi } from "vitest";
import { chooseRecordingCodec, getFileExtension, type CodecCandidate } from "./codecSupport";

describe("chooseRecordingCodec", () => {
  const candidates: CodecCandidate[] = [
    { mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", extension: "mp4", label: "H.264/AAC MP4" },
    { mimeType: "video/webm;codecs=vp9,opus", extension: "webm", label: "VP9/Opus WebM" },
    { mimeType: "video/webm;codecs=vp8,opus", extension: "webm", label: "VP8/Opus WebM" }
  ];

  it("prefers MP4 when MediaRecorder reports support", () => {
    const isTypeSupported = vi.fn((mime: string) => mime.startsWith("video/mp4"));

    const result = chooseRecordingCodec(isTypeSupported, candidates);

    expect(result).toMatchObject({
      mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      extension: "mp4",
      isFallback: false
    });
  });

  it("falls back to WebM and marks it as a fallback when MP4 is unavailable", () => {
    const isTypeSupported = vi.fn((mime: string) => mime.includes("vp9"));

    const result = chooseRecordingCodec(isTypeSupported, candidates);

    expect(result).toMatchObject({
      mimeType: "video/webm;codecs=vp9,opus",
      extension: "webm",
      isFallback: true
    });
  });

  it("returns an unsupported result when no candidates are available", () => {
    const result = chooseRecordingCodec(() => false, candidates);

    expect(result.supported).toBe(false);
    expect(result.mimeType).toBe("");
  });
});

describe("getFileExtension", () => {
  it("derives the real download extension from the selected codec", () => {
    expect(getFileExtension({ mimeType: "video/mp4", extension: "mp4", label: "MP4" })).toBe("mp4");
    expect(getFileExtension({ mimeType: "video/webm", extension: "webm", label: "WebM" })).toBe("webm");
  });
});

