import { describe, expect, it } from "vitest";
import {
  addMarker,
  buildQualityLayers,
  createInitialQualityMap,
  setTrimRange,
  type QualitySample
} from "./qualityMap";

describe("quality map", () => {
  it("adds user markers in timestamp order", () => {
    const map = createInitialQualityMap();

    const withMarkers = addMarker(addMarker(map, 12, "Retake"), 3, "Intro");

    expect(withMarkers.markers.map((marker) => marker.label)).toEqual(["Intro", "Retake"]);
  });

  it("clamps trim ranges to the recording duration", () => {
    const map = createInitialQualityMap(60);

    expect(setTrimRange(map, -5, 75).trimRange).toEqual({ start: 0, end: 60 });
  });

  it("translates telemetry samples into keyed streaming quality layers", () => {
    const samples: QualitySample[] = [
      { timestamp: 1, audioPeak: 0.95, noiseFloor: 0.12, fps: 30, targetFps: 30, bitrate: 4_000_000 },
      { timestamp: 2, audioPeak: 0.2, noiseFloor: 0.42, fps: 18, targetFps: 30, bitrate: 900_000 }
    ];

    const layers = buildQualityLayers(samples);

    expect(layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "clipping", severity: "danger", timestamp: 1 }),
        expect.objectContaining({ key: "noise", severity: "warning", timestamp: 2 }),
        expect.objectContaining({ key: "fps", severity: "danger", timestamp: 2 }),
        expect.objectContaining({ key: "bitrate", severity: "warning", timestamp: 2 })
      ])
    );
  });
});

