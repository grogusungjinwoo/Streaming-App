import { describe, expect, it, vi } from "vitest";
import { createVoicePatchSession, normalizeVoicePatchSettings } from "./voicePatchService";

function createNode() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn()
  };
}

describe("voicePatchService", () => {
  it("normalizes AutoPatch settings to a safe broadcast range", () => {
    expect(normalizeVoicePatchSettings({ enabled: true, strength: 1.8 })).toEqual({ enabled: true, strength: 1 });
    expect(normalizeVoicePatchSettings({ enabled: false, strength: 0.8 })).toEqual({ enabled: false, strength: 0 });
  });

  it("creates a processed recording stream and closes the audio graph on cleanup", async () => {
    const source = createNode();
    const highpass = { ...createNode(), type: "", frequency: { value: 0 }, Q: { value: 0 } };
    const presence = { ...createNode(), type: "", frequency: { value: 0 }, gain: { value: 0 }, Q: { value: 0 } };
    const gate = { ...createNode(), curve: null as Float32Array | null, oversample: "none" as OverSampleType };
    const compressor = {
      ...createNode(),
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 }
    };
    const limiter = {
      ...createNode(),
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 }
    };
    const outputGain = { ...createNode(), gain: { value: 0 } };
    const processedAudio = { id: "processed-audio" } as MediaStreamTrack;
    const videoTrack = { id: "video" } as MediaStreamTrack;
    const destination = {
      ...createNode(),
      stream: { getAudioTracks: () => [processedAudio] }
    };
    const close = vi.fn().mockResolvedValue(undefined);
    const context = {
      createMediaStreamSource: vi.fn(() => source),
      createBiquadFilter: vi.fn().mockReturnValueOnce(highpass).mockReturnValueOnce(presence),
      createWaveShaper: vi.fn(() => gate),
      createDynamicsCompressor: vi.fn().mockReturnValueOnce(compressor).mockReturnValueOnce(limiter),
      createGain: vi.fn(() => outputGain),
      createMediaStreamDestination: vi.fn(() => destination),
      close
    };
    const inputStream = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [{ id: "raw-audio" } as MediaStreamTrack]
    } as MediaStream;
    const createdStreams: MediaStreamTrack[][] = [];

    const session = createVoicePatchSession(inputStream, { enabled: true, strength: 0.65 }, {
      createAudioContext: () => context as unknown as AudioContext,
      createMediaStream: (tracks) => {
        createdStreams.push(tracks);
        return {
          getVideoTracks: () => tracks.filter((track) => track.id === "video"),
          getAudioTracks: () => tracks.filter((track) => track.id === "processed-audio")
        } as MediaStream;
      }
    });

    expect(session.stream.getVideoTracks()).toEqual([videoTrack]);
    expect(session.stream.getAudioTracks()).toEqual([processedAudio]);
    expect(createdStreams[0]).toEqual([videoTrack, processedAudio]);
    expect(context.createBiquadFilter).toHaveBeenCalledTimes(2);
    expect(gate.curve).toBeInstanceOf(Float32Array);

    await session.cleanup();

    expect(source.disconnect).toHaveBeenCalled();
    expect(destination.disconnect).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
