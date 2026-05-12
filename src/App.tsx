import {
  AudioLines,
  Camera,
  Circle,
  Download,
  Gauge,
  Map,
  Mic,
  Pause,
  Play,
  Radio,
  Scissors,
  Square,
  Video
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCaptureConstraints,
  capturePresets,
  listMediaDevices,
  type CapturePreset,
  type DeviceOption
} from "./services/deviceService";
import { buildExportFileName, canUseDesktopExporter, exportRecording } from "./services/exportService";
import { getBrowserCodecChoice, type CodecChoice } from "./services/codecSupport";
import {
  addMarker,
  buildQualityLayers,
  createInitialQualityMap,
  setTrimRange,
  type QualityMapState,
  type QualitySample
} from "./services/qualityMap";
import { RecorderService } from "./services/recorderService";
import {
  calculateAudioTelemetry,
  describeStreamSettings,
  estimateFileGrowth,
  type AudioTelemetry
} from "./services/telemetryService";

type RecorderStatus = "idle" | "preview" | "recording" | "paused" | "review" | "exporting" | "error";

type ExportMessage = {
  kind: "info" | "success" | "warning" | "error";
  text: string;
};

const initialAudioTelemetry: AudioTelemetry = {
  peak: 0,
  rms: 0,
  noiseFloor: 0,
  isClipping: false
};

export function App() {
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState("");
  const [preset, setPreset] = useState<CapturePreset>(capturePresets[0]);
  const [codecChoice, setCodecChoice] = useState<CodecChoice>(() => getBrowserCodecChoice());
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [qualityMap, setQualityMap] = useState<QualityMapState>(() => createInitialQualityMap());
  const [qualitySamples, setQualitySamples] = useState<QualitySample[]>([]);
  const [audioTelemetry, setAudioTelemetry] = useState<AudioTelemetry>(initialAudioTelemetry);
  const [actualSettings, setActualSettings] = useState("No active capture");
  const [error, setError] = useState("");
  const [exportMessage, setExportMessage] = useState<ExportMessage>({
    kind: "info",
    text: "Recordings stay on this device. The website does not upload or store media."
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<RecorderService | null>(null);
  const recordingStartRef = useRef<number>(0);
  const objectUrlRef = useRef("");
  const latestAudioRef = useRef<AudioTelemetry>(initialAudioTelemetry);

  const cameraDevices = devices.filter((device) => device.kind === "videoinput");
  const microphoneDevices = devices.filter((device) => device.kind === "audioinput");
  const isDesktop = canUseDesktopExporter();
  const qualityLayers = useMemo(() => buildQualityLayers(qualitySamples), [qualitySamples]);
  const selectedFormat = isDesktop ? "Desktop MP4" : codecChoice.label;
  const actualFileExtension = isDesktop ? "mp4" : codecChoice.extension;
  const estimatedSize = estimateFileGrowth(elapsedSeconds, preset.videoBitsPerSecond + 160_000);
  const streamStatusText = getStatusText(status);

  useEffect(() => {
    void refreshDevices();
    setCodecChoice(getBrowserCodecChoice());
  }, []);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (!stream || (status !== "preview" && status !== "recording" && status !== "paused")) return;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let frame = 0;
    let stopped = false;

    const readAudio = () => {
      analyser.getFloatTimeDomainData(data);
      const telemetry = calculateAudioTelemetry(data);
      latestAudioRef.current = telemetry;
      setAudioTelemetry(telemetry);
      if (!stopped) frame = requestAnimationFrame(readAudio);
    };

    readAudio();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      source.disconnect();
      void audioContext.close();
    };
  }, [stream, status]);

  useEffect(() => {
    if (status !== "recording") return;

    const interval = window.setInterval(() => {
      const nextElapsed = Math.round((Date.now() - recordingStartRef.current) / 1000);
      setElapsedSeconds(nextElapsed);
      setQualityMap((current) => ({ ...current, duration: nextElapsed, trimRange: { ...current.trimRange, end: nextElapsed } }));
      setQualitySamples((samples) =>
        [
          ...samples,
          {
            timestamp: nextElapsed,
            audioPeak: latestAudioRef.current.peak,
            noiseFloor: latestAudioRef.current.noiseFloor,
            fps: stream?.getVideoTracks()[0]?.getSettings().frameRate ?? preset.frameRate,
            targetFps: preset.frameRate,
            bitrate: preset.videoBitsPerSecond
          }
        ].slice(-180)
      );
    }, 1000);

    return () => window.clearInterval(interval);
  }, [preset.frameRate, preset.videoBitsPerSecond, status, stream]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [stream]);

  async function refreshDevices() {
    const nextDevices = await listMediaDevices();
    setDevices(nextDevices);
    setSelectedCameraId((current) => current || nextDevices.find((device) => device.kind === "videoinput")?.deviceId || "");
    setSelectedMicrophoneId((current) => current || nextDevices.find((device) => device.kind === "audioinput")?.deviceId || "");
  }

  async function startPreview() {
    setError("");
    setExportMessage({
      kind: "info",
      text: "Requesting camera and microphone permission. Capture starts only after you press record."
    });

    try {
      stream?.getTracks().forEach((track) => track.stop());
      const nextStream = await navigator.mediaDevices.getUserMedia(
        buildCaptureConstraints(preset, selectedCameraId, selectedMicrophoneId)
      );
      setStream(nextStream);
      setStatus("preview");
      setRecordedBlob(null);
      clearObjectUrl();
      updateActualSettings(nextStream);
      await refreshDevices();
      setExportMessage({
        kind: "success",
        text: "Preview is local. No camera, microphone, or recording data leaves this device."
      });
    } catch (previewError) {
      setStatus("error");
      setError(getMediaErrorMessage(previewError));
    }
  }

  function startRecording() {
    if (!stream || !codecChoice.supported) {
      setError("Start preview first and confirm the browser supports MediaRecorder.");
      setStatus("error");
      return;
    }

    setRecordedBlob(null);
    clearObjectUrl();
    setQualitySamples([]);
    setQualityMap(createInitialQualityMap());
    setElapsedSeconds(0);
    recordingStartRef.current = Date.now();
    recorderRef.current = new RecorderService();
    recorderRef.current.start(stream, {
      mimeType: codecChoice.mimeType,
      videoBitsPerSecond: preset.videoBitsPerSecond,
      audioBitsPerSecond: 160_000
    });
    setStatus("recording");
    setExportMessage({
      kind: codecChoice.isFallback ? "warning" : "info",
      text: codecChoice.isFallback
        ? "This browser is recording WebM. The PC app can convert the result to MP4."
        : "This browser supports native MP4 recording for web export."
    });
  }

  function pauseRecording() {
    recorderRef.current?.pause();
    setStatus("paused");
  }

  function resumeRecording() {
    recorderRef.current?.resume();
    recordingStartRef.current = Date.now() - elapsedSeconds * 1000;
    setStatus("recording");
  }

  async function stopRecording() {
    if (!recorderRef.current) return;
    const result = await recorderRef.current.stop();
    recorderRef.current.cleanup();
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setRecordedBlob(result.blob);
    const url = URL.createObjectURL(result.blob);
    objectUrlRef.current = url;
    setPreviewUrl(url);
    setStatus("review");
    setQualityMap((current) => ({ ...current, duration: elapsedSeconds, trimRange: { start: 0, end: elapsedSeconds } }));
    setExportMessage({
      kind: "success",
      text: `Recording ready for local ${isDesktop ? "MP4 export" : `${codecChoice.extension.toUpperCase()} download`}. Camera and microphone tracks were released.`
    });
  }

  function addTimelineMarker() {
    const timestamp = status === "recording" || status === "paused" ? elapsedSeconds : qualityMap.trimRange.start;
    setQualityMap((current) => addMarker(current, timestamp, `Marker ${current.markers.length + 1}`));
  }

  function updateTrimStart(value: string) {
    setQualityMap((current) => setTrimRange(current, Number(value), current.trimRange.end));
  }

  function updateTrimEnd(value: string) {
    setQualityMap((current) => setTrimRange(current, current.trimRange.start, Number(value)));
  }

  async function handleExport() {
    if (!recordedBlob) return;
    setStatus("exporting");
    const fileName = buildExportFileName("streaming-app-recording", actualFileExtension);

    try {
      const result = await exportRecording(recordedBlob, fileName);
      setStatus("review");
      if (result.canceled) {
        setExportMessage({ kind: "info", text: "Export canceled. The recording is still available in this session." });
      } else {
        setExportMessage({
          kind: "success",
          text: result.filePath
            ? `MP4 exported locally to ${result.filePath}.`
            : `Downloaded ${fileName}. No upload was performed.`
        });
      }
    } catch (exportError) {
      setStatus("review");
      setExportMessage({ kind: "error", text: exportError instanceof Error ? exportError.message : "Export failed." });
    }
  }

  function discardRecording() {
    clearObjectUrl();
    setRecordedBlob(null);
    setPreviewUrl("");
    setElapsedSeconds(0);
    setQualitySamples([]);
    setQualityMap(createInitialQualityMap());
    setStatus("idle");
    setExportMessage({ kind: "info", text: "Recording discarded locally and object URL revoked." });
  }

  function clearObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
  }

  function updateActualSettings(nextStream: MediaStream) {
    const settings = nextStream.getVideoTracks()[0]?.getSettings();
    if (!settings) {
      setActualSettings("No video track settings reported");
      return;
    }
    const description = describeStreamSettings(
      { width: preset.width, height: preset.height, frameRate: preset.frameRate },
      settings
    );
    setActualSettings(`${description.actual} actual · requested ${description.requested}`);
  }

  return (
    <main className="app-shell">
      <header className="top-strip">
        <div>
          <p className="eyeline">Streaming-App</p>
          <h1>Local Control Room Recorder</h1>
        </div>
        <div className="top-metrics" aria-label="Current recorder state">
          <StatusPill label={streamStatusText} tone={status === "recording" ? "recording" : status === "error" ? "danger" : "live"} />
          <StatusPill label={selectedFormat} tone={codecChoice.isFallback && !isDesktop ? "warning" : "neutral"} />
          <StatusPill label={isDesktop ? "PC MP4 exporter" : "GitHub Pages mode"} tone={isDesktop ? "live" : "neutral"} />
        </div>
      </header>

      <section className="control-room" aria-label="Recorder control room">
        <aside className="panel source-rail">
          <PanelHeader icon={<Camera size={16} />} title="Sources" />
          <label>
            Camera
            <select value={selectedCameraId} onChange={(event) => setSelectedCameraId(event.target.value)}>
              {cameraDevices.length === 0 ? <option value="">Default camera</option> : null}
              {cameraDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Microphone
            <select value={selectedMicrophoneId} onChange={(event) => setSelectedMicrophoneId(event.target.value)}>
              {microphoneDevices.length === 0 ? <option value="">Default microphone</option> : null}
              {microphoneDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quality preset
            <select
              value={preset.label}
              onChange={(event) => setPreset(capturePresets.find((item) => item.label === event.target.value) ?? capturePresets[0])}
            >
              {capturePresets.map((item) => (
                <option key={item.label} value={item.label}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="source-stats">
            <Metric label="Requested" value={`${preset.width}x${preset.height}`} />
            <Metric label="Frame rate" value={`${preset.frameRate} fps`} />
            <Metric label="Bitrate" value={`${(preset.videoBitsPerSecond / 1_000_000).toFixed(1)} Mbps`} />
          </div>
          <button className="secondary-button" type="button" onClick={() => void startPreview()}>
            <Play size={16} />
            Enable preview
          </button>
        </aside>

        <section className="stage-panel panel">
          <div className="stage-header">
            <PanelHeader icon={<Video size={16} />} title="Camera Stage" />
            <span>{actualSettings}</span>
          </div>
          <div className="preview-stage">
            {stream ? (
              <video ref={videoRef} autoPlay muted playsInline />
            ) : previewUrl ? (
              <video src={previewUrl} controls playsInline />
            ) : (
              <div className="empty-stage">
                <Video size={48} />
                <p>Enable preview to arm the camera locally.</p>
              </div>
            )}
            <div className="safe-frame" aria-hidden="true" />
          </div>
          {error ? <p className="error-message">{error}</p> : null}
        </section>

        <aside className="panel signal-rail">
          <PanelHeader icon={<Gauge size={16} />} title="Signal Intelligence" />
          <LiveMeter label="Audio peak" value={audioTelemetry.peak} danger={audioTelemetry.isClipping} />
          <LiveMeter label="RMS" value={audioTelemetry.rms} />
          <LiveMeter label="Noise floor" value={audioTelemetry.noiseFloor} warning={audioTelemetry.noiseFloor > 0.35} />
          <div className="signal-grid">
            <Metric label="Elapsed" value={formatTime(elapsedSeconds)} />
            <Metric label="Est. size" value={formatBytes(estimatedSize)} />
            <Metric label="Markers" value={qualityMap.markers.length.toString()} />
            <Metric label="Faults" value={qualityLayers.length.toString()} />
          </div>
          <div className={`export-note ${exportMessage.kind}`}>{exportMessage.text}</div>
        </aside>

        <section className="panel timeline-panel">
          <div className="timeline-heading">
            <PanelHeader icon={<Map size={16} />} title="Quality Terrain Map" />
            <div className="legend">
              <span className="legend-item good">Clean</span>
              <span className="legend-item warning">Noise/Drop</span>
              <span className="legend-item danger">Fault</span>
            </div>
          </div>
          <QualityTerrain duration={Math.max(qualityMap.duration, 1)} layers={qualityLayers} markers={qualityMap.markers} />
          <div className="trim-controls">
            <label>
              Trim start
              <input
                type="range"
                min="0"
                max={Math.max(qualityMap.duration, 1)}
                value={qualityMap.trimRange.start}
                onChange={(event) => updateTrimStart(event.target.value)}
              />
            </label>
            <label>
              Trim end
              <input
                type="range"
                min="0"
                max={Math.max(qualityMap.duration, 1)}
                value={qualityMap.trimRange.end}
                onChange={(event) => updateTrimEnd(event.target.value)}
              />
            </label>
            <span>
              Range {formatTime(qualityMap.trimRange.start)} to {formatTime(qualityMap.trimRange.end)}
            </span>
          </div>
        </section>
      </section>

      <section className="command-bar" aria-label="Recording controls">
        <button className="record-button" type="button" disabled={!stream || status === "recording"} onClick={startRecording}>
          <Circle size={18} fill="currentColor" />
          Record
        </button>
        <button type="button" disabled={status !== "recording"} onClick={pauseRecording}>
          <Pause size={18} />
          Pause
        </button>
        <button type="button" disabled={status !== "paused"} onClick={resumeRecording}>
          <Play size={18} />
          Resume
        </button>
        <button type="button" disabled={status !== "recording" && status !== "paused"} onClick={() => void stopRecording()}>
          <Square size={18} />
          Stop
        </button>
        <button type="button" disabled={status !== "recording" && status !== "paused" && status !== "review"} onClick={addTimelineMarker}>
          <Radio size={18} />
          Marker
        </button>
        <button type="button" disabled={!recordedBlob || status === "exporting"} onClick={() => void handleExport()}>
          <Download size={18} />
          {isDesktop ? "Export MP4" : `Download ${actualFileExtension.toUpperCase()}`}
        </button>
        <button type="button" disabled={!recordedBlob} onClick={discardRecording}>
          <Scissors size={18} />
          Discard
        </button>
      </section>
    </main>
  );
}

function PanelHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="panel-header">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "live" | "recording" | "warning" | "danger" | "neutral" }) {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LiveMeter({ label, value, warning, danger }: { label: string; value: number; warning?: boolean; danger?: boolean }) {
  const level = Math.max(0, Math.min(value, 1));

  return (
    <div className="live-meter">
      <div>
        <span>{label}</span>
        <strong>{Math.round(level * 100)}%</strong>
      </div>
      <div className={`meter-track ${danger ? "danger" : warning ? "warning" : ""}`}>
        <span style={{ transform: `scaleX(${level})` }} />
      </div>
    </div>
  );
}

function QualityTerrain({
  duration,
  layers,
  markers
}: {
  duration: number;
  layers: ReturnType<typeof buildQualityLayers>;
  markers: QualityMapState["markers"];
}) {
  return (
    <div className="quality-terrain" aria-label="Quality timeline">
      <div className="terrain-strata" />
      {layers.map((layer, index) => (
        <span
          key={`${layer.key}-${layer.timestamp}-${index}`}
          className={`terrain-fault ${layer.severity}`}
          style={{ left: `${Math.min(98, (layer.timestamp / duration) * 100)}%` }}
          title={`${layer.label} at ${formatTime(layer.timestamp)}`}
        />
      ))}
      {markers.map((marker) => (
        <span
          key={marker.id}
          className="terrain-marker"
          style={{ left: `${Math.min(98, (marker.timestamp / duration) * 100)}%` }}
          title={`${marker.label} at ${formatTime(marker.timestamp)}`}
        />
      ))}
    </div>
  );
}

function getMediaErrorMessage(error: unknown): string {
  if (!(error instanceof DOMException)) return "Unable to start preview.";
  if (error.name === "NotAllowedError") return "Camera or microphone permission was denied.";
  if (error.name === "NotFoundError") return "No camera or microphone was found.";
  if (error.name === "OverconstrainedError") return "The selected quality preset is not supported by this device.";
  return error.message;
}

function getStatusText(status: RecorderStatus): string {
  const labels: Record<RecorderStatus, string> = {
    idle: "Idle",
    preview: "Preview armed",
    recording: "Recording",
    paused: "Paused",
    review: "Review",
    exporting: "Exporting",
    error: "Needs attention"
  };
  return labels[status];
}

function formatTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (wholeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

