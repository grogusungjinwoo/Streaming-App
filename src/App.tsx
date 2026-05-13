import {
  AudioLines,
  Camera,
  Circle,
  Download,
  Gauge,
  Map,
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
  frameRateOptions,
  getVideoBitsPerSecond,
  listMediaDevices,
  type AudioCaptureProfile,
  type CapturePreset,
  type DeviceOption,
  type FrameRateOption
} from "./services/deviceService";
import { buildExportFileName, canUseDesktopRenderer, canUseDesktopSaver, saveRenderedMp4 } from "./services/exportService";
import { getBrowserCodecChoice, type CodecChoice } from "./services/codecSupport";
import { getBlobInputExtension, renderMp4Recording } from "./services/mp4RenderService";
import {
  addMarker,
  buildQualityLayers,
  createInitialQualityMap,
  getTrimDuration,
  setTrimRange,
  type QualityMapState,
  type QualitySample
} from "./services/qualityMap";
import { RecorderService } from "./services/recorderService";
import {
  canDownloadRenderedMp4,
  createReviewRenderState,
  markReviewRenderReady,
  markReviewRenderStale,
  type ReviewRenderState
} from "./services/reviewState";
import {
  calculateEstimatedFps,
  calculateAudioTelemetry,
  describeStreamSettings,
  estimateFileGrowth,
  type AudioTelemetry
} from "./services/telemetryService";
import {
  createDefaultVoiceMasteringSettings,
  type VoiceMasteringMode,
  type VoiceRenderDiagnostics
} from "./services/voiceMasteringService";

type RecorderStatus = "idle" | "preview" | "recording" | "paused" | "rendering" | "review" | "exporting" | "error";

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
  const [frameRate, setFrameRate] = useState<FrameRateOption>(30);
  const [audioCaptureProfile, setAudioCaptureProfile] = useState<AudioCaptureProfile>("studio-raw");
  const [voiceMastering, setVoiceMastering] = useState(() => createDefaultVoiceMasteringSettings());
  const [renderDiagnostics, setRenderDiagnostics] = useState<VoiceRenderDiagnostics | null>(null);
  const [codecChoice, setCodecChoice] = useState<CodecChoice>(() => getBrowserCodecChoice());
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [renderedBlob, setRenderedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [actualFrameRate, setActualFrameRate] = useState<FrameRateOption | number>(30);
  const [deliveredFps, setDeliveredFps] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [qualityMap, setQualityMap] = useState<QualityMapState>(() => createInitialQualityMap());
  const [qualitySamples, setQualitySamples] = useState<QualitySample[]>([]);
  const [reviewRender, setReviewRender] = useState<ReviewRenderState>(() => createReviewRenderState());
  const [audioTelemetry, setAudioTelemetry] = useState<AudioTelemetry>(initialAudioTelemetry);
  const [actualSettings, setActualSettings] = useState("No active capture");
  const [error, setError] = useState("");
  const [exportMessage, setExportMessage] = useState<ExportMessage>({
    kind: "info",
    text: "Recordings stay on this device. The website does not upload or store media."
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reviewStatusRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<RecorderService | null>(null);
  const recordingStartRef = useRef<number>(0);
  const objectUrlRef = useRef("");
  const latestAudioRef = useRef<AudioTelemetry>(initialAudioTelemetry);

  const cameraDevices = devices.filter((device) => device.kind === "videoinput");
  const microphoneDevices = devices.filter((device) => device.kind === "audioinput");
  const canRenderOnDesktop = canUseDesktopRenderer();
  const canSaveOnDesktop = canUseDesktopSaver();
  const isDesktop = canRenderOnDesktop || canSaveOnDesktop;
  const qualityLayers = useMemo(() => buildQualityLayers(qualitySamples), [qualitySamples]);
  const selectedFormat = isDesktop ? "Desktop MP4 render" : "Browser MP4 render";
  const targetVideoBitsPerSecond = getVideoBitsPerSecond(preset, frameRate);
  const renderFrameRate = Math.max(1, Math.round(Math.min(frameRate, deliveredFps || actualFrameRate || frameRate)));
  const estimatedSize = estimateFileGrowth(elapsedSeconds, targetVideoBitsPerSecond + 192_000);
  const streamStatusText = getStatusText(status);
  const canDownloadMp4 = Boolean(renderedBlob && canDownloadRenderedMp4(reviewRender));
  const trimDurationSeconds = getTrimDuration(qualityMap);
  const voicePatchStrength = voiceMastering.masteringStrength;
  const perfectPopStrength = voiceMastering.pitchLockAmount;

  useEffect(() => {
    void refreshDevices();
    setCodecChoice(getBrowserCodecChoice());
  }, []);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || (status !== "preview" && status !== "recording" && status !== "paused")) {
      setDeliveredFps(0);
      return;
    }

    if (typeof video.requestVideoFrameCallback !== "function") return;

    let frameCallback = 0;
    let stopped = false;
    const timestamps: number[] = [];

    const readFrame: VideoFrameRequestCallback = (timestamp) => {
      timestamps.push(timestamp);
      if (timestamps.length > 40) timestamps.shift();
      const nextFps = calculateEstimatedFps(timestamps);
      if (nextFps > 0) setDeliveredFps(Math.round(nextFps));
      if (!stopped) frameCallback = video.requestVideoFrameCallback(readFrame);
    };

    frameCallback = video.requestVideoFrameCallback(readFrame);

    return () => {
      stopped = true;
      if (frameCallback && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameCallback);
      }
    };
  }, [status, stream]);

  useEffect(() => {
    if (reviewRender.status === "ready" || reviewRender.status === "error") {
      reviewStatusRef.current?.focus();
    }
  }, [reviewRender.status, reviewRender.version]);

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
            fps: deliveredFps || stream?.getVideoTracks()[0]?.getSettings().frameRate || frameRate,
            targetFps: frameRate,
            bitrate: targetVideoBitsPerSecond
          }
        ].slice(-180)
      );
    }, 1000);

    return () => window.clearInterval(interval);
  }, [deliveredFps, frameRate, status, stream, targetVideoBitsPerSecond]);

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
    setRenderDiagnostics(null);

    try {
      stream?.getTracks().forEach((track) => track.stop());
      const nextStream = await navigator.mediaDevices.getUserMedia(
        buildCaptureConstraints(preset, frameRate, selectedCameraId, selectedMicrophoneId, audioCaptureProfile)
      );
      setStream(nextStream);
      setStatus("preview");
      setRecordedBlob(null);
      setRenderedBlob(null);
      setReviewRender(createReviewRenderState());
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
    setRenderedBlob(null);
    setReviewRender(createReviewRenderState());
    setRenderDiagnostics(null);
    clearObjectUrl();
    setQualitySamples([]);
    setQualityMap(createInitialQualityMap());
    setElapsedSeconds(0);
    recordingStartRef.current = Date.now();
    recorderRef.current = new RecorderService();
    try {
      recorderRef.current.start(stream, {
        mimeType: codecChoice.mimeType,
        videoBitsPerSecond: targetVideoBitsPerSecond,
        audioBitsPerSecond: 192_000
      });
    } catch (recordingError) {
      recorderRef.current = null;
      setStatus("error");
      setError(recordingError instanceof Error ? recordingError.message : "Unable to start the raw studio recorder.");
      return;
    }
    setStatus("recording");
    setExportMessage({
      kind: codecChoice.isFallback ? "warning" : "info",
      text: codecChoice.isFallback
        ? "This browser is capturing WebM, then rendering an MP4 locally after you stop."
        : "This browser supports native MP4 capture. The review render still creates the final MP4."
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
    const duration = Math.max(elapsedSeconds, Math.round((Date.now() - recordingStartRef.current) / 1000));
    const trimRange = { start: 0, end: duration };
    setQualityMap((current) => ({ ...current, duration, trimRange }));
    setExportMessage({
      kind: "info",
      text: "Recording captured. Rendering the local MP4 review file now."
    });
    await renderReviewMp4(result.blob, trimRange);
  }

  function addTimelineMarker() {
    const timestamp = status === "recording" || status === "paused" ? elapsedSeconds : qualityMap.trimRange.start;
    setQualityMap((current) => addMarker(current, timestamp, `Marker ${current.markers.length + 1}`));
  }

  function updateTrimStart(value: string) {
    markMp4ReviewStale();
    setQualityMap((current) => {
      const next = setTrimRange(current, Number(value), current.trimRange.end);
      return next;
    });
  }

  function updateTrimEnd(value: string) {
    markMp4ReviewStale();
    setQualityMap((current) => {
      const next = setTrimRange(current, current.trimRange.start, Number(value));
      return next;
    });
  }

  function updateAudioCaptureProfile(value: AudioCaptureProfile) {
    setAudioCaptureProfile(value);
    setExportMessage({
      kind: "info",
      text: "Mic capture profile will apply the next time preview is enabled."
    });
  }

  function updateVoiceMasteringMode(value: VoiceMasteringMode) {
    setVoiceMastering((current) => ({ ...current, mode: value }));
    setRenderDiagnostics(null);
    markMp4ReviewStale();
  }

  function updateVoiceMasteringStrength(value: number) {
    setVoiceMastering((current) => ({ ...current, masteringStrength: clamp01(value) }));
    setRenderDiagnostics(null);
    markMp4ReviewStale();
  }

  function updatePitchLockAmount(value: number) {
    setVoiceMastering((current) => ({ ...current, pitchLockAmount: clamp01(value) }));
    setRenderDiagnostics(null);
    markMp4ReviewStale();
  }

  function updateFrequencySculptor(key: keyof typeof voiceMastering.frequencySculptor, value: number) {
    setVoiceMastering((current) => ({
      ...current,
      frequencySculptor: {
        ...current.frequencySculptor,
        [key]: clamp01(value)
      }
    }));
    setRenderDiagnostics(null);
    markMp4ReviewStale();
  }

  function markMp4ReviewStale() {
    if (!recordedBlob) return;
    setReviewRender((current) => markReviewRenderStale(current));
    setExportMessage({
      kind: "warning",
      text: "Review settings changed. Render a fresh MP4 before downloading."
    });
  }

  async function renderReviewMp4(sourceBlob = recordedBlob, trimRange = qualityMap.trimRange) {
    if (!sourceBlob) return;
    setStatus("rendering");
    setReviewRender({
      status: "rendering",
      progress: 0,
      message: "Rendering MP4 review locally..."
    });
    setRenderedBlob(null);
    setRenderDiagnostics(null);

    try {
      const mp4Blob = await renderMp4Recording(sourceBlob, {
        inputExtension: getBlobInputExtension(sourceBlob, codecChoice.extension),
        trimRange,
        frameRate: renderFrameRate,
        videoBitsPerSecond: targetVideoBitsPerSecond,
        voicePatchStrength,
        perfectPopStrength,
        voiceMastering,
        useDesktopRenderer: canRenderOnDesktop,
        onDiagnostics: setRenderDiagnostics,
        onProgress: (progress) => {
          setReviewRender({
            status: "rendering",
            progress,
            message: `Rendering MP4 review ${Math.round(progress * 100)}%`
          });
        }
      });

      setRenderedBlob(mp4Blob);
      setVideoPreviewBlob(mp4Blob);
      setReviewRender(markReviewRenderReady(createReviewRenderState(), mp4Blob));
      setStatus("review");
      setExportMessage({
        kind: "success",
        text: "MP4 review is ready. You can preview it here, revise trim or voice polish, or download the rendered MP4."
      });
    } catch (renderError) {
      setStatus("review");
      setVideoPreviewBlob(sourceBlob);
      setReviewRender({
        status: "error",
        progress: 0,
        error: renderError instanceof Error ? renderError.message : "MP4 render failed."
      });
      setExportMessage({
        kind: "error",
        text: renderError instanceof Error ? renderError.message : "MP4 render failed. The original recording is still available in this session."
      });
    }
  }

  async function handleExport() {
    if (!renderedBlob || !canDownloadRenderedMp4(reviewRender)) return;
    setStatus("exporting");
    const fileName = buildExportFileName("streaming-app-recording", "mp4");

    try {
      const result = await saveRenderedMp4(renderedBlob, fileName);
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
    setRenderedBlob(null);
    setPreviewUrl("");
    setElapsedSeconds(0);
    setQualitySamples([]);
    setQualityMap(createInitialQualityMap());
    setReviewRender(createReviewRenderState());
    setRenderDiagnostics(null);
    setStatus("idle");
    setExportMessage({ kind: "info", text: "Recording discarded locally and object URL revoked." });
  }

  function setVideoPreviewBlob(blob: Blob) {
    clearObjectUrl();
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    setPreviewUrl(url);
  }

  function clearObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
  }

  function updateActualSettings(nextStream: MediaStream) {
    const settings = nextStream.getVideoTracks()[0]?.getSettings();
    const audioSettings = nextStream.getAudioTracks()[0]?.getSettings();
    if (!settings) {
      setActualSettings("No video track settings reported");
      return;
    }
    setActualFrameRate(settings.frameRate ?? frameRate);
    const description = describeStreamSettings(
      { width: preset.width, height: preset.height, frameRate },
      settings
    );
    const micDescription = audioSettings
      ? `mic ${audioSettings.sampleRate ?? "auto"} Hz, ${audioSettings.channelCount ?? "auto"} ch, EC ${formatTrackFlag(
          audioSettings.echoCancellation
        )}, NS ${formatTrackFlag(audioSettings.noiseSuppression)}, AGC ${formatTrackFlag(audioSettings.autoGainControl)}`
      : "mic settings unavailable";
    setActualSettings(`${description.actual} actual - requested ${description.requested} - ${micDescription}`);
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
            Mic capture
            <select
              disabled={status === "recording" || status === "paused" || status === "rendering"}
              value={audioCaptureProfile}
              onChange={(event) => updateAudioCaptureProfile(event.target.value as AudioCaptureProfile)}
            >
              <option value="studio-raw">Studio Raw</option>
              <option value="browser-cleanup">Browser Cleanup</option>
            </select>
          </label>
          <label>
            Quality preset
            <select
              disabled={status === "recording" || status === "paused" || status === "rendering"}
              value={preset.label}
              onChange={(event) => {
                setPreset(capturePresets.find((item) => item.label === event.target.value) ?? capturePresets[0]);
                markMp4ReviewStale();
              }}
            >
              {capturePresets.map((item) => (
                <option key={item.label} value={item.label}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="frame-rate-control" role="group" aria-label="Frame rate">
            <span>Frame rate</span>
            <div className="frame-rate-options">
              {frameRateOptions.map((option) => (
                <button
                  key={option}
                  className={`frame-rate-button ${frameRate === option ? "active" : ""}`}
                  type="button"
                  disabled={status === "recording" || status === "paused" || status === "rendering"}
                  aria-pressed={frameRate === option}
                  onClick={() => {
                    setFrameRate(option);
                    markMp4ReviewStale();
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div className="mastering-panel" aria-label="Frequency Sculptor">
            <div className="mastering-heading">
              <span>
                <AudioLines size={14} />
                Frequency Sculptor
              </span>
              <strong>48k AAC</strong>
            </div>
            <label>
              Voice mode
              <select
                disabled={status === "recording" || status === "paused" || status === "rendering"}
                value={voiceMastering.mode}
                onChange={(event) => updateVoiceMasteringMode(event.target.value as VoiceMasteringMode)}
              >
                <option value="synthetic-pitch-lock">Synthetic Pitch Lock</option>
                <option value="broadcast">Broadcast</option>
                <option value="natural">Natural</option>
                <option value="off">Off</option>
              </select>
            </label>
            <MasteringSlider
              label="Mastering Strength"
              value={voiceMastering.masteringStrength}
              disabled={status === "recording" || status === "paused" || status === "rendering"}
              onChange={updateVoiceMasteringStrength}
            />
            <MasteringSlider
              label="Pitch Lock Amount"
              value={voiceMastering.pitchLockAmount}
              disabled={status === "recording" || status === "paused" || status === "rendering" || voiceMastering.mode !== "synthetic-pitch-lock"}
              onChange={updatePitchLockAmount}
            />
            <MasteringSlider
              label="Rumble Cut"
              value={voiceMastering.frequencySculptor.rumbleCut}
              disabled={status === "recording" || status === "paused" || status === "rendering"}
              onChange={(value) => updateFrequencySculptor("rumbleCut", value)}
            />
            <MasteringSlider
              label="Warmth"
              value={voiceMastering.frequencySculptor.warmth}
              disabled={status === "recording" || status === "paused" || status === "rendering"}
              onChange={(value) => updateFrequencySculptor("warmth", value)}
            />
            <MasteringSlider
              label="Presence"
              value={voiceMastering.frequencySculptor.presence}
              disabled={status === "recording" || status === "paused" || status === "rendering"}
              onChange={(value) => updateFrequencySculptor("presence", value)}
            />
            <MasteringSlider
              label="Harshness"
              value={voiceMastering.frequencySculptor.harshness}
              disabled={status === "recording" || status === "paused" || status === "rendering"}
              onChange={(value) => updateFrequencySculptor("harshness", value)}
            />
            <MasteringSlider
              label="De-crackle"
              value={voiceMastering.frequencySculptor.deCrackle}
              disabled={status === "recording" || status === "paused" || status === "rendering"}
              onChange={(value) => updateFrequencySculptor("deCrackle", value)}
            />
          </div>
          <div className="source-stats">
            <Metric label="Requested" value={`${preset.width}x${preset.height}`} />
            <Metric label="Frame rate" value={`${frameRate} fps`} />
            <Metric label="Bitrate" value={`${(targetVideoBitsPerSecond / 1_000_000).toFixed(1)} Mbps`} />
            <Metric label="Mic profile" value={audioCaptureProfile === "studio-raw" ? "Raw" : "Cleanup"} />
          </div>
          <button className="secondary-button" type="button" disabled={status === "rendering"} onClick={() => void startPreview()}>
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
          <LiveMeter label="Mastering" value={voiceMastering.masteringStrength} />
          <LiveMeter label="Pitch lock" value={voiceMastering.mode === "synthetic-pitch-lock" ? voiceMastering.pitchLockAmount : 0} />
          <LiveMeter label="Audio peak" value={audioTelemetry.peak} danger={audioTelemetry.isClipping} />
          <LiveMeter label="RMS" value={audioTelemetry.rms} />
          <LiveMeter label="Noise floor" value={audioTelemetry.noiseFloor} warning={audioTelemetry.noiseFloor > 0.35} />
          <div className="signal-grid">
            <Metric label="Elapsed" value={formatTime(elapsedSeconds)} />
            <Metric label="Est. size" value={formatBytes(estimatedSize)} />
            <Metric label="Markers" value={qualityMap.markers.length.toString()} />
            <Metric label="Faults" value={qualityLayers.length.toString()} />
            <Metric label="MP4" value={reviewRender.status === "ready" ? "Ready" : reviewRender.status === "rendering" ? "Rendering" : "Waiting"} />
            <Metric label="Delivered FPS" value={deliveredFps ? `${deliveredFps}` : `${Math.round(actualFrameRate)}`} />
            <Metric label="Target Hz" value={renderDiagnostics?.targetPitchHz ? renderDiagnostics.targetPitchHz.toFixed(1) : "Pending"} />
            <Metric
              label="Voice conf."
              value={renderDiagnostics ? `${Math.round(renderDiagnostics.voicedFrameConfidence * 100)}%` : "Pending"}
            />
            <Metric label="Peak" value={renderDiagnostics ? `${Math.round(renderDiagnostics.peakLevel * 100)}%` : "Pending"} />
            <Metric label="Audio Hz" value={renderDiagnostics ? `${renderDiagnostics.sampleRate}` : "Pending"} />
          </div>
          <div className={`export-note ${exportMessage.kind}`} role="status" aria-live="polite">
            {exportMessage.text}
          </div>
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
            <label className="trim-control">
              <span>Start moves to</span>
              <div className="trim-second-row">
                <input
                  className="trim-second-input"
                  type="number"
                  min="0"
                  max={Math.max(qualityMap.duration, 1)}
                  step="0.1"
                  value={formatSecondsInput(qualityMap.trimRange.start)}
                  disabled={!recordedBlob || status === "rendering"}
                  onChange={(event) => updateTrimStart(event.target.value)}
                  aria-label="Trim start seconds"
                />
                <small>sec</small>
              </div>
              <input
                type="range"
                min="0"
                max={Math.max(qualityMap.duration, 1)}
                step="0.1"
                value={qualityMap.trimRange.start}
                disabled={!recordedBlob || status === "rendering"}
                onChange={(event) => updateTrimStart(event.target.value)}
              />
            </label>
            <label className="trim-control">
              <span>End moves to</span>
              <div className="trim-second-row">
                <input
                  className="trim-second-input"
                  type="number"
                  min="0"
                  max={Math.max(qualityMap.duration, 1)}
                  step="0.1"
                  value={formatSecondsInput(qualityMap.trimRange.end)}
                  disabled={!recordedBlob || status === "rendering"}
                  onChange={(event) => updateTrimEnd(event.target.value)}
                  aria-label="Trim end seconds"
                />
                <small>sec</small>
              </div>
              <input
                type="range"
                min="0"
                max={Math.max(qualityMap.duration, 1)}
                step="0.1"
                value={qualityMap.trimRange.end}
                disabled={!recordedBlob || status === "rendering"}
                onChange={(event) => updateTrimEnd(event.target.value)}
              />
            </label>
            <span className="render-length">
              Rendered length {formatSecondsInput(trimDurationSeconds)} sec
            </span>
          </div>
          <div
            ref={reviewStatusRef}
            className={`review-status ${reviewRender.status === "stale" ? "stale-render" : reviewRender.status}`}
            tabIndex={-1}
            role="status"
            aria-live={reviewRender.status === "error" ? "assertive" : "polite"}
          >
            <span>{getReviewStatusText(reviewRender, canSaveOnDesktop)}</span>
            {reviewRender.status === "rendering" ? (
              <div
                className="render-progress"
                role="progressbar"
                aria-label="MP4 render progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((reviewRender.progress ?? 0) * 100)}
              >
                <div className="render-progress-track">
                  <span className="render-progress-fill" style={{ transform: `scaleX(${reviewRender.progress ?? 0})` }} />
                </div>
              </div>
            ) : null}
            <div className="review-actions">
              <button
                type="button"
                disabled={!recordedBlob || status === "rendering" || reviewRender.status === "ready"}
                onClick={() => void renderReviewMp4()}
              >
                <Scissors size={16} />
                Render MP4
              </button>
            </div>
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
        <button type="button" disabled={!canDownloadMp4 || status === "exporting" || status === "rendering"} onClick={() => void handleExport()}>
          <Download size={18} />
          {canSaveOnDesktop ? "Save MP4" : "Download MP4"}
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

function MasteringSlider({
  label,
  value,
  disabled,
  onChange
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const percent = Math.round(clamp01(value) * 100);

  return (
    <label className="mastering-slider">
      <span>
        {label}
        <strong>{percent}%</strong>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={percent}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
    </label>
  );
}

function LiveMeter({ label, value, warning, danger }: { label: string; value: number; warning?: boolean; danger?: boolean }) {
  const level = Math.max(0, Math.min(value, 1));
  const percentage = Math.round(level * 100);

  return (
    <div className="live-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}>
      <div>
        <span>{label}</span>
        <strong>{percentage}%</strong>
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
  const timelineLabel = `${layers.length} quality events and ${markers.length} markers across ${formatTime(duration)}.`;

  return (
    <div className="quality-terrain" role="img" aria-label={timelineLabel}>
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
      <ul className="sr-only">
        {layers.map((layer, index) => (
          <li key={`${layer.key}-${layer.timestamp}-${index}`}>
            {layer.label} at {formatTime(layer.timestamp)}, severity {layer.severity}
          </li>
        ))}
        {markers.map((marker) => (
          <li key={`marker-${marker.id}`}>
            {marker.label} at {formatTime(marker.timestamp)}
          </li>
        ))}
      </ul>
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
    rendering: "Rendering MP4",
    review: "Review",
    exporting: "Exporting",
    error: "Needs attention"
  };
  return labels[status];
}

function getReviewStatusText(reviewRender: ReviewRenderState, canSaveOnDesktop: boolean): string {
  if (reviewRender.status === "ready") return canSaveOnDesktop ? "Rendered MP4 ready to save" : "Rendered MP4 ready to download";
  if (reviewRender.status === "rendering") return reviewRender.message || "Rendering local MP4 review";
  if (reviewRender.status === "stale") return "Render a fresh MP4 to use the latest trim and voice settings";
  if (reviewRender.status === "error") return reviewRender.error || "MP4 render needs attention";
  return "Stop a recording to create an MP4 review";
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

function formatSecondsInput(seconds: number): string {
  return (Number.isFinite(seconds) ? Math.max(0, seconds) : 0).toFixed(1);
}

function clamp01(value: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1);
}

function formatTrackFlag(value: unknown): string {
  if (value === true) return "on";
  if (value === false) return "off";
  return "auto";
}
