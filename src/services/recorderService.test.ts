import { describe, expect, it, vi } from "vitest";
import { RecorderService, type RecorderEvent } from "./recorderService";

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onresume: (() => void) | null = null;

  constructor(
    public stream: MediaStream,
    public options: MediaRecorderOptions
  ) {}

  start() {
    this.state = "recording";
  }

  pause() {
    this.state = "paused";
    this.onpause?.();
  }

  resume() {
    this.state = "recording";
    this.onresume?.();
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["clip"], { type: this.options.mimeType }) } as BlobEvent);
    this.onstop?.();
  }
}

function makeStream() {
  const stop = vi.fn();
  return {
    getTracks: () => [{ stop }],
    getVideoTracks: () => [{ getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }) }],
    getAudioTracks: () => [{ getSettings: () => ({ echoCancellation: true, noiseSuppression: true }) }],
    stop
  };
}

describe("RecorderService", () => {
  it("records lifecycle events and returns a blob with the selected MIME type", async () => {
    const events: RecorderEvent[] = [];
    const stream = makeStream() as unknown as MediaStream;
    const service = new RecorderService({
      createMediaRecorder: (inputStream, options) => new FakeMediaRecorder(inputStream, options) as unknown as MediaRecorder,
      now: () => 1000,
      onEvent: (event) => events.push(event)
    });

    service.start(stream, { mimeType: "video/webm;codecs=vp9,opus", videoBitsPerSecond: 4_000_000 });
    service.pause();
    service.resume();
    const result = await service.stop();

    expect(result.blob.type).toBe("video/webm;codecs=vp9,opus");
    expect(events.map((event) => event.type)).toEqual(["start", "pause", "resume", "data", "stop"]);
  });

  it("stops all tracks during cleanup", () => {
    const stream = makeStream();
    const service = new RecorderService({
      createMediaRecorder: (inputStream, options) => new FakeMediaRecorder(inputStream, options) as unknown as MediaRecorder
    });

    service.start(stream as unknown as MediaStream, { mimeType: "video/webm" });
    service.cleanup();

    expect(stream.stop).toHaveBeenCalledOnce();
  });
});

