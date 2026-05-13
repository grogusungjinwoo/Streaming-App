export type DeviceOption = {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
};

export type CapturePreset = {
  width: number;
  height: number;
  frameRate: number;
  videoBitsPerSecond: number;
  label: string;
};

export type CaptureFrameRate = 30 | 60;
export type FrameRateOption = CaptureFrameRate;
export type AudioCaptureProfile = "studio-raw" | "browser-cleanup";

export const capturePresets: CapturePreset[] = [
  { label: "Studio 1080p", width: 1920, height: 1080, frameRate: 30, videoBitsPerSecond: 6_000_000 },
  { label: "Smooth 720p", width: 1280, height: 720, frameRate: 30, videoBitsPerSecond: 5_000_000 },
  { label: "Balanced 720p", width: 1280, height: 720, frameRate: 30, videoBitsPerSecond: 3_500_000 }
];

export const captureFrameRates: CaptureFrameRate[] = [30, 60];
export const frameRateOptions = captureFrameRates;

export async function listMediaDevices(): Promise<DeviceOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];

  const devices = await navigator.mediaDevices.enumerateDevices();

  return devices
    .filter((device) => device.kind === "videoinput" || device.kind === "audioinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      kind: device.kind,
      label: device.label || `${device.kind === "videoinput" ? "Camera" : "Microphone"} ${index + 1}`
    }));
}

export function getVideoBitsPerSecond(preset: CapturePreset, frameRate: number): number {
  return frameRate >= 60 ? Math.round(preset.videoBitsPerSecond * 1.5) : preset.videoBitsPerSecond;
}

export function buildCaptureConstraints(
  preset: CapturePreset,
  frameRate: number,
  cameraId?: string,
  microphoneId?: string,
  audioCaptureProfile?: AudioCaptureProfile
): MediaStreamConstraints;
export function buildCaptureConstraints(
  preset: CapturePreset,
  cameraId?: string,
  microphoneId?: string
): MediaStreamConstraints;
export function buildCaptureConstraints(
  preset: CapturePreset,
  frameRateOrCameraId: number | string = preset.frameRate,
  cameraIdOrMicrophoneId?: string,
  microphoneId?: string,
  audioCaptureProfile: AudioCaptureProfile = "browser-cleanup"
): MediaStreamConstraints {
  const selectedFrameRate = typeof frameRateOrCameraId === "number" ? frameRateOrCameraId : preset.frameRate;
  const selectedCameraId = typeof frameRateOrCameraId === "number" ? cameraIdOrMicrophoneId : frameRateOrCameraId;
  const selectedMicrophoneId = typeof frameRateOrCameraId === "number" ? microphoneId : cameraIdOrMicrophoneId;

  return {
    video: {
      width: { ideal: preset.width },
      height: { ideal: preset.height },
      frameRate: { ideal: selectedFrameRate },
      deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined
    },
    audio: buildAudioConstraints(selectedMicrophoneId, audioCaptureProfile)
  };
}

function buildAudioConstraints(microphoneId: string | undefined, audioCaptureProfile: AudioCaptureProfile): MediaTrackConstraints {
  const deviceId = microphoneId ? { exact: microphoneId } : undefined;

  if (audioCaptureProfile === "browser-cleanup") {
    return {
      deviceId,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: { ideal: 48_000 },
      channelCount: { ideal: 1 }
    };
  }

  return {
    deviceId,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: { ideal: 48_000 },
    channelCount: { ideal: 1 }
  };
}
