export type VoicePatchSettings = {
  enabled: boolean;
  strength: number;
};

export type VoicePatchSession = {
  stream: MediaStream;
  cleanup: () => Promise<void>;
};

export type VoicePatchDependencies = {
  createAudioContext?: () => AudioContext;
  createMediaStream?: (tracks: MediaStreamTrack[]) => MediaStream;
};

type DisconnectableNode = {
  disconnect: () => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeVoicePatchSettings(settings: VoicePatchSettings): VoicePatchSettings {
  const strength = clamp(Number.isFinite(settings.strength) ? settings.strength : 0, 0, 1);

  return settings.enabled ? { enabled: true, strength } : { enabled: false, strength: 0 };
}

export function createVoicePatchSession(
  inputStream: MediaStream,
  settings: VoicePatchSettings,
  dependencies: VoicePatchDependencies = {}
): VoicePatchSession {
  const normalizedSettings = normalizeVoicePatchSettings(settings);
  const audioTracks = inputStream.getAudioTracks();

  if (!normalizedSettings.enabled || normalizedSettings.strength === 0 || audioTracks.length === 0) {
    return {
      stream: inputStream,
      cleanup: async () => undefined
    };
  }

  const audioContext = dependencies.createAudioContext?.() ?? createDefaultAudioContext();
  const source = audioContext.createMediaStreamSource(inputStream);
  const highpass = audioContext.createBiquadFilter();
  const presence = audioContext.createBiquadFilter();
  const gate = audioContext.createWaveShaper();
  const compressor = audioContext.createDynamicsCompressor();
  const limiter = audioContext.createDynamicsCompressor();
  const outputGain = audioContext.createGain();
  const destination = audioContext.createMediaStreamDestination();
  const strength = normalizedSettings.strength;

  highpass.type = "highpass";
  highpass.frequency.value = 85;
  highpass.Q.value = 0.7;

  presence.type = "peaking";
  presence.frequency.value = 3200;
  presence.Q.value = 1.1;
  presence.gain.value = 1.5 + strength * 2.5;

  gate.curve = createSoftGateCurve(strength);
  gate.oversample = "2x";

  compressor.threshold.value = -16 - strength * 10;
  compressor.knee.value = 18;
  compressor.ratio.value = 2 + strength * 2.5;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.16;

  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.08;

  outputGain.gain.value = 1 + strength * 0.08;

  source.connect(highpass);
  highpass.connect(presence);
  presence.connect(gate);
  gate.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(outputGain);
  outputGain.connect(destination);

  const processedAudioTracks = destination.stream.getAudioTracks();
  const tracks = [...inputStream.getVideoTracks(), ...processedAudioTracks];
  const createMediaStream = dependencies.createMediaStream ?? ((streamTracks) => new MediaStream(streamTracks));
  const stream = createMediaStream(tracks);
  const nodes: DisconnectableNode[] = [source, highpass, presence, gate, compressor, limiter, outputGain, destination];
  let cleanedUp = false;

  return {
    stream,
    cleanup: async () => {
      if (cleanedUp) return;
      cleanedUp = true;

      for (const node of nodes) {
        node.disconnect();
      }

      await audioContext.close();
    }
  };
}

function createSoftGateCurve(strength: number): Float32Array<ArrayBuffer> {
  const samples = 4096;
  const curve = new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT));
  const threshold = 0.015 + strength * 0.025;
  const floor = 0.15 + (1 - strength) * 0.25;

  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    const gain = magnitude < threshold ? floor : 1;
    curve[index] = x * gain;
  }

  return curve;
}

function createDefaultAudioContext(): AudioContext {
  const browserWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const AudioContextCtor = window.AudioContext ?? browserWindow.webkitAudioContext;

  if (!AudioContextCtor) {
    throw new Error("Web Audio is not available in this browser.");
  }

  return new AudioContextCtor();
}
