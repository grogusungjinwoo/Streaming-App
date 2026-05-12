export type DesktopExportPayload = {
  data: ArrayBuffer;
  inputExtension: string;
  suggestedName: string;
};

export type DesktopSavePayload = {
  data: ArrayBuffer;
  suggestedName: string;
};

export type DesktopRenderPayload = {
  data: ArrayBuffer;
  inputExtension: string;
  suggestedName: string;
  trimRange: {
    start: number;
    end: number;
  };
  frameRate: number;
  videoBitsPerSecond: number;
  voicePatchStrength: number;
};

export type DesktopExportResult = {
  canceled: boolean;
  filePath?: string;
  error?: string;
};

export type DesktopRenderResult = {
  data?: ArrayBuffer;
  canceled?: boolean;
  error?: string;
};

export type StreamingAppBridge = {
  exportMp4?: (payload: DesktopExportPayload) => Promise<DesktopExportResult>;
  saveMp4?: (payload: DesktopSavePayload) => Promise<DesktopExportResult>;
  renderMp4?: (payload: DesktopRenderPayload) => Promise<DesktopRenderResult>;
  isDesktop: boolean;
};

export type BridgeWindow = Window & {
  streamingApp?: Partial<StreamingAppBridge>;
};

installBlobArrayBufferFallback();

export function buildExportFileName(title: string, extension: string, date = new Date()): string {
  const cleanedTitle = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safeTitle = cleanedTitle || "streaming-app";
  const [day, timeWithMs] = date.toISOString().split("T");
  const timestamp = `${day}-${timeWithMs.replace(/\..+$/, "").replace(/:/g, "")}`;

  return `${safeTitle}-${timestamp}.${extension}`;
}

export function canUseDesktopExporter(target: unknown = window): boolean {
  return typeof getBridge(target).exportMp4 === "function";
}

export function canUseDesktopSaver(target: unknown = window): boolean {
  return typeof getBridge(target).saveMp4 === "function";
}

export function canUseDesktopRenderer(target: unknown = window): boolean {
  return typeof getBridge(target).renderMp4 === "function";
}

export function downloadRecording(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function exportRecording(
  blob: Blob,
  fileName: string,
  target: BridgeWindow = window
): Promise<DesktopExportResult> {
  const bridge = getBridge(target);

  if (canUseDesktopExporter(target)) {
    return bridge.exportMp4!({
      data: await blobToArrayBuffer(blob),
      inputExtension: blob.type.includes("mp4") ? "mp4" : "webm",
      suggestedName: fileName.replace(/\.[^.]+$/, ".mp4")
    });
  }

  downloadRecording(blob, fileName);
  return { canceled: false };
}

export async function saveRenderedMp4(
  blob: Blob,
  fileName: string,
  target: BridgeWindow = window
): Promise<DesktopExportResult> {
  const bridge = getBridge(target);

  if (canUseDesktopSaver(target)) {
    return bridge.saveMp4!({
      data: await blobToArrayBuffer(blob),
      suggestedName: fileName.replace(/\.[^.]+$/, ".mp4")
    });
  }

  downloadRecording(blob, fileName.replace(/\.[^.]+$/, ".mp4"));
  return { canceled: false };
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }

  return new Response(blob).arrayBuffer();
}

function installBlobArrayBufferFallback(): void {
  if (typeof Blob === "undefined" || typeof Blob.prototype.arrayBuffer === "function") return;

  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true,
    value(this: Blob) {
      return new Response(this).arrayBuffer();
    }
  });
}

function getBridge(target: unknown): Partial<StreamingAppBridge> {
  return ((target as { streamingApp?: Partial<StreamingAppBridge> }).streamingApp ?? {}) as Partial<StreamingAppBridge>;
}
