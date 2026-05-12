export type CodecCandidate = {
  mimeType: string;
  extension: "mp4" | "webm";
  label: string;
};

export type CodecChoice = CodecCandidate & {
  supported: boolean;
  isFallback: boolean;
};

export const recordingCodecCandidates: CodecCandidate[] = [
  {
    mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    extension: "mp4",
    label: "H.264/AAC MP4"
  },
  {
    mimeType: "video/webm;codecs=vp9,opus",
    extension: "webm",
    label: "VP9/Opus WebM"
  },
  {
    mimeType: "video/webm;codecs=vp8,opus",
    extension: "webm",
    label: "VP8/Opus WebM"
  },
  {
    mimeType: "video/webm",
    extension: "webm",
    label: "Browser WebM"
  }
];

export function chooseRecordingCodec(
  isTypeSupported: (mimeType: string) => boolean = MediaRecorder.isTypeSupported.bind(MediaRecorder),
  candidates: CodecCandidate[] = recordingCodecCandidates
): CodecChoice {
  const selected = candidates.find((candidate) => isTypeSupported(candidate.mimeType));

  if (!selected) {
    return {
      mimeType: "",
      extension: "webm",
      label: "Unsupported",
      supported: false,
      isFallback: true
    };
  }

  return {
    ...selected,
    supported: true,
    isFallback: selected.extension !== "mp4"
  };
}

export function getFileExtension(codec: CodecCandidate): string {
  return codec.extension;
}

export function getBrowserCodecChoice(): CodecChoice {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return {
      mimeType: "",
      extension: "webm",
      label: "MediaRecorder unavailable",
      supported: false,
      isFallback: true
    };
  }

  return chooseRecordingCodec();
}
