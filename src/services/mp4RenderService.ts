import ffmpegCoreUrl from "@ffmpeg/core?url";
import ffmpegCoreWasmUrl from "@ffmpeg/core/wasm?url";

export type RenderTrimRange = {
  start: number;
  end: number;
};

export type FfmpegRenderArgsOptions = {
  inputPath: string;
  outputPath: string;
  trimRange: RenderTrimRange;
  frameRate: number;
  videoBitsPerSecond: number;
  voicePatchStrength: number;
};

export type RenderMp4Options = Omit<FfmpegRenderArgsOptions, "inputPath" | "outputPath"> & {
  inputBlob: Blob;
  inputPath?: string;
  outputPath?: string;
  onProgress?: (progress: number) => void;
};

export type RenderMp4RecordingOptions = {
  inputExtension: string;
  trimRange: RenderTrimRange;
  frameRate: number;
  videoBitsPerSecond: number;
  voicePatchStrength: number;
  useDesktopRenderer?: boolean;
  onProgress?: (progress: number) => void;
};

export type RenderMp4Result = {
  blob: Blob;
  fileName: string;
  objectUrl: string;
};

type DesktopRenderBridge = {
  streamingApp?: {
    renderMp4?: (payload: {
      data: ArrayBuffer;
      inputExtension: string;
      suggestedName: string;
      trimRange: RenderTrimRange;
      frameRate: number;
      videoBitsPerSecond: number;
      voicePatchStrength: number;
    }) => Promise<{
      data?: ArrayBuffer;
      error?: string;
      canceled?: boolean;
    }>;
  };
};

type FfmpegConstructor = new () => {
  load: (config?: { coreURL?: string; wasmURL?: string }) => Promise<unknown>;
  writeFile: (path: string, data: Uint8Array) => Promise<unknown>;
  exec: (args: string[]) => Promise<number>;
  readFile: (path: string) => Promise<Uint8Array | string>;
  deleteFile?: (path: string) => Promise<unknown>;
  on?: (event: "progress", callback: (event: { progress: number }) => void) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatSeconds(seconds: number): string {
  return Number.isInteger(seconds) ? seconds.toString() : seconds.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function clampRenderTrimRange(trimRange: RenderTrimRange, durationSeconds: number): RenderTrimRange {
  const duration = Math.max(0, Number.isFinite(durationSeconds) ? durationSeconds : 0);
  const start = clamp(Number.isFinite(trimRange.start) ? trimRange.start : 0, 0, duration);
  let end = clamp(Number.isFinite(trimRange.end) ? trimRange.end : duration, 0, duration);

  if (end <= start) {
    end = duration;
  }

  return { start, end };
}

export function buildAudioPatchFilter(strength: number): string {
  const normalizedStrength = clamp(Number.isFinite(strength) ? strength : 0, 0, 1);

  if (normalizedStrength === 0) return "anull";

  const denoiseFloor = Math.round(-20 - normalizedStrength * 12);
  const presenceGain = (1.5 + normalizedStrength * 2.5).toFixed(1);
  const compressorThreshold = Math.round(-16 - normalizedStrength * 10);
  const compressorRatio = (2 + normalizedStrength * 2.5).toFixed(1);
  const makeupGain = (1 + normalizedStrength * 1.2).toFixed(1);

  return [
    "highpass=f=85",
    `afftdn=nf=${denoiseFloor}`,
    `equalizer=f=3200:t=q:w=1.1:g=${presenceGain}`,
    `acompressor=threshold=${compressorThreshold}dB:ratio=${compressorRatio}:attack=8:release=160:makeup=${makeupGain}`,
    "alimiter=limit=0.93:attack=3:release=80"
  ].join(",");
}

export function buildFfmpegRenderArgs(options: FfmpegRenderArgsOptions): string[] {
  const trimRange = clampRenderTrimRange(options.trimRange, Math.max(options.trimRange.start, options.trimRange.end));
  const trimDuration = Math.max(0, trimRange.end - trimRange.start);
  const args = [
    "-i",
    options.inputPath,
    "-ss",
    formatSeconds(trimRange.start),
    "-t",
    formatSeconds(trimDuration),
    "-r",
    Math.round(options.frameRate).toString(),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    `${Math.round(options.videoBitsPerSecond / 1000)}k`,
    "-c:a",
    "aac",
    "-b:a",
    "192k"
  ];
  const audioFilter = buildAudioPatchFilter(options.voicePatchStrength);

  if (audioFilter !== "anull") {
    args.push("-af", audioFilter);
  }

  args.push("-movflags", "+faststart", options.outputPath);

  return args;
}

export async function renderMp4(options: RenderMp4Options): Promise<RenderMp4Result> {
  const { FFmpeg, fetchFile } = await loadFfmpegModules();
  const ffmpeg = new FFmpeg();
  const inputPath = options.inputPath ?? "input.webm";
  const outputPath = options.outputPath ?? "review.mp4";

  ffmpeg.on?.("progress", ({ progress }) => options.onProgress?.(progress));
  await ffmpeg.load({
    coreURL: await toBlobUrl(ffmpegCoreUrl, "text/javascript"),
    wasmURL: await toBlobUrl(ffmpegCoreWasmUrl, "application/wasm")
  });
  await ffmpeg.writeFile(inputPath, await fetchFile(options.inputBlob));
  await ffmpeg.exec(
    buildFfmpegRenderArgs({
      inputPath,
      outputPath,
      trimRange: options.trimRange,
      frameRate: options.frameRate,
      videoBitsPerSecond: options.videoBitsPerSecond,
      voicePatchStrength: options.voicePatchStrength
    })
  );

  const rendered = await ffmpeg.readFile(outputPath);
  const bytes = typeof rendered === "string" ? new TextEncoder().encode(rendered) : rendered;
  const blob = new Blob([copyBytesToArrayBuffer(bytes)], { type: "video/mp4" });

  await Promise.allSettled([ffmpeg.deleteFile?.(inputPath), ffmpeg.deleteFile?.(outputPath)]);

  return {
    blob,
    fileName: outputPath.split(/[\\/]/).pop() ?? outputPath,
    objectUrl: URL.createObjectURL(blob)
  };
}

export async function renderMp4Recording(sourceBlob: Blob, options: RenderMp4RecordingOptions): Promise<Blob> {
  const suggestedName = "review.mp4";

  if (options.useDesktopRenderer) {
    const bridge = (window as unknown as DesktopRenderBridge).streamingApp;

    if (typeof bridge?.renderMp4 === "function") {
      const result = await bridge.renderMp4({
        data: await blobToArrayBuffer(sourceBlob),
        inputExtension: options.inputExtension,
        suggestedName,
        trimRange: options.trimRange,
        frameRate: options.frameRate,
        videoBitsPerSecond: options.videoBitsPerSecond,
        voicePatchStrength: options.voicePatchStrength
      });

      if (result.error) throw new Error(result.error);
      if (result.canceled) throw new Error("MP4 render was canceled.");
      if (!result.data) throw new Error("Desktop MP4 renderer did not return rendered data.");

      return new Blob([result.data], { type: "video/mp4" });
    }
  }

  const renderResult = await renderMp4({
    inputBlob: sourceBlob,
    inputPath: `input.${options.inputExtension.replace(/^\.+/, "") || "webm"}`,
    outputPath: suggestedName,
    trimRange: options.trimRange,
    frameRate: options.frameRate,
    videoBitsPerSecond: options.videoBitsPerSecond,
    voicePatchStrength: options.voicePatchStrength,
    onProgress: options.onProgress
  });

  return renderResult.blob;
}

export function getBlobInputExtension(blob: Blob, fallbackExtension: string): string {
  if (blob.type.includes("mp4")) return "mp4";
  if (blob.type.includes("webm")) return "webm";
  return fallbackExtension.replace(/^\.+/, "") || "webm";
}

async function loadFfmpegModules(): Promise<{
  FFmpeg: FfmpegConstructor;
  fetchFile: (source: Blob) => Promise<Uint8Array>;
  toBlobURL: (url: string, mimeType: string) => Promise<string>;
}> {
  try {
    const [ffmpegModule, utilModule] = await Promise.all([import("@ffmpeg/ffmpeg"), import("@ffmpeg/util")]);

    return {
      FFmpeg: (ffmpegModule as { FFmpeg: FfmpegConstructor }).FFmpeg,
      fetchFile: (utilModule as { fetchFile: (source: Blob) => Promise<Uint8Array> }).fetchFile,
      toBlobURL: (utilModule as { toBlobURL: (url: string, mimeType: string) => Promise<string> }).toBlobURL
    };
  } catch (error) {
    throw new Error(
      `Unable to load the in-browser MP4 renderer. Install @ffmpeg/ffmpeg, @ffmpeg/util, and @ffmpeg/core. ${
        error instanceof Error ? error.message : ""
      }`.trim()
    );
  }
}

let coreBlobUrls: Promise<{ coreURL: string; wasmURL: string }> | null = null;

async function toBlobUrl(url: string, mimeType: string): Promise<string> {
  if (!coreBlobUrls) {
    coreBlobUrls = loadFfmpegModules().then(async ({ toBlobURL }) => ({
      coreURL: await toBlobURL(ffmpegCoreUrl, "text/javascript"),
      wasmURL: await toBlobURL(ffmpegCoreWasmUrl, "application/wasm")
    }));
  }

  const urls = await coreBlobUrls;
  return mimeType === "application/wasm" ? urls.wasmURL : urls.coreURL;
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }

  return new Response(blob).arrayBuffer();
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}
