export type AudioTelemetry = {
  peak: number;
  rms: number;
  noiseFloor: number;
  isClipping: boolean;
};

export type SettingsDescription = {
  requested: string;
  actual: string;
};

export function calculateAudioTelemetry(samples: Float32Array): AudioTelemetry {
  if (samples.length === 0) {
    return { peak: 0, rms: 0, noiseFloor: 0, isClipping: false };
  }

  let peak = 0;
  let sumSquares = 0;
  let noiseFloor = Number.POSITIVE_INFINITY;

  for (const sample of samples) {
    const level = Math.abs(sample);
    peak = Math.max(peak, level);
    noiseFloor = Math.min(noiseFloor, level);
    sumSquares += sample * sample;
  }

  return {
    peak,
    rms: Math.sqrt(sumSquares / samples.length),
    noiseFloor: Number.isFinite(noiseFloor) ? noiseFloor : 0,
    isClipping: peak >= 0.95
  };
}

export function calculateEstimatedFps(frameTimestamps: number[]): number {
  if (frameTimestamps.length < 2) return 0;

  const first = frameTimestamps[0];
  const last = frameTimestamps[frameTimestamps.length - 1];
  const seconds = (last - first) / 1000;

  return seconds <= 0 ? 0 : (frameTimestamps.length - 1) / seconds;
}

export function estimateFileGrowth(elapsedSeconds: number, bitsPerSecond: number): number {
  return Math.round((elapsedSeconds * bitsPerSecond) / 8);
}

export function describeStreamSettings(
  requested: Pick<MediaTrackSettings, "width" | "height" | "frameRate">,
  actual: Pick<MediaTrackSettings, "width" | "height" | "frameRate">
): SettingsDescription {
  return {
    requested: formatVideoSettings(requested),
    actual: formatVideoSettings(actual)
  };
}

function formatVideoSettings(settings: Pick<MediaTrackSettings, "width" | "height" | "frameRate">): string {
  const width = settings.width ?? 0;
  const height = settings.height ?? 0;
  const fps = settings.frameRate ?? 0;

  return `${width}x${height} @ ${fps} fps`;
}

