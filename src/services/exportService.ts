export type DesktopExportPayload = {
  data: ArrayBuffer;
  inputExtension: string;
  suggestedName: string;
};

export type DesktopExportResult = {
  canceled: boolean;
  filePath?: string;
  error?: string;
};

export type StreamingAppBridge = {
  exportMp4: (payload: DesktopExportPayload) => Promise<DesktopExportResult>;
  isDesktop: boolean;
};

export type BridgeWindow = Window & {
  streamingApp?: Partial<StreamingAppBridge>;
};

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

export function canUseDesktopExporter(target: { streamingApp?: { exportMp4?: unknown } } = window): boolean {
  return typeof target.streamingApp?.exportMp4 === "function";
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
  if (canUseDesktopExporter(target)) {
    return target.streamingApp!.exportMp4!({
      data: await blob.arrayBuffer(),
      inputExtension: blob.type.includes("mp4") ? "mp4" : "webm",
      suggestedName: fileName.replace(/\.[^.]+$/, ".mp4")
    });
  }

  downloadRecording(blob, fileName);
  return { canceled: false };
}
