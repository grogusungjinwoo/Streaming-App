export type QualitySeverity = "good" | "warning" | "danger";

export type QualitySample = {
  timestamp: number;
  audioPeak: number;
  noiseFloor: number;
  fps: number;
  targetFps: number;
  bitrate: number;
};

export type QualityLayer = {
  key: "clipping" | "noise" | "fps" | "bitrate" | "marker";
  label: string;
  timestamp: number;
  severity: QualitySeverity;
};

export type QualityMarker = {
  id: string;
  timestamp: number;
  label: string;
};

export type TrimRange = {
  start: number;
  end: number;
};

export type QualityMapState = {
  duration: number;
  markers: QualityMarker[];
  trimRange: TrimRange;
};

export function createInitialQualityMap(duration = 0): QualityMapState {
  return {
    duration,
    markers: [],
    trimRange: { start: 0, end: duration }
  };
}

export function addMarker(map: QualityMapState, timestamp: number, label: string): QualityMapState {
  const marker: QualityMarker = {
    id: `${timestamp}-${label}`.replace(/\s+/g, "-").toLowerCase(),
    timestamp: Math.max(0, timestamp),
    label
  };

  return {
    ...map,
    markers: [...map.markers, marker].sort((a, b) => a.timestamp - b.timestamp)
  };
}

export function setTrimRange(map: QualityMapState, start: number, end: number): QualityMapState {
  const duration = Number.isFinite(map.duration) ? Math.max(0, map.duration) : 0;
  const safeStart = Number.isFinite(start) ? start : 0;
  const safeEnd = Number.isFinite(end) ? end : duration;
  const clampedStart = Math.max(0, Math.min(safeStart, duration));
  const clampedEnd = Math.max(clampedStart, Math.min(safeEnd, duration));

  return {
    ...map,
    trimRange: { start: clampedStart, end: clampedEnd }
  };
}

export function getTrimDuration(map: QualityMapState): number {
  return Math.max(0, map.trimRange.end - map.trimRange.start);
}

export function buildQualityLayers(samples: QualitySample[]): QualityLayer[] {
  return samples.flatMap((sample) => {
    const layers: QualityLayer[] = [];

    if (sample.audioPeak >= 0.92) {
      layers.push({
        key: "clipping",
        label: "Audio clipping",
        timestamp: sample.timestamp,
        severity: "danger"
      });
    }

    if (sample.noiseFloor >= 0.35) {
      layers.push({
        key: "noise",
        label: "High noise floor",
        timestamp: sample.timestamp,
        severity: "warning"
      });
    }

    if (sample.fps < sample.targetFps * 0.75) {
      layers.push({
        key: "fps",
        label: "Frame instability",
        timestamp: sample.timestamp,
        severity: "danger"
      });
    }

    if (sample.bitrate < 1_250_000) {
      layers.push({
        key: "bitrate",
        label: "Bitrate drop",
        timestamp: sample.timestamp,
        severity: "warning"
      });
    }

    return layers;
  });
}
