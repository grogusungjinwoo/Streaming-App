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

export const capturePresets: CapturePreset[] = [
  { label: "Studio 1080p", width: 1920, height: 1080, frameRate: 30, videoBitsPerSecond: 6_000_000 },
  { label: "Smooth 720p", width: 1280, height: 720, frameRate: 60, videoBitsPerSecond: 5_000_000 },
  { label: "Balanced 720p", width: 1280, height: 720, frameRate: 30, videoBitsPerSecond: 3_500_000 }
];

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

export function buildCaptureConstraints(
  preset: CapturePreset,
  cameraId?: string,
  microphoneId?: string
): MediaStreamConstraints {
  return {
    video: {
      width: { ideal: preset.width },
      height: { ideal: preset.height },
      frameRate: { ideal: preset.frameRate },
      deviceId: cameraId ? { exact: cameraId } : undefined
    },
    audio: {
      deviceId: microphoneId ? { exact: microphoneId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  };
}
