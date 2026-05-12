export type RecorderEvent =
  | { type: "start"; timestamp: number }
  | { type: "pause"; timestamp: number }
  | { type: "resume"; timestamp: number }
  | { type: "data"; timestamp: number; size: number }
  | { type: "stop"; timestamp: number; size: number };

export type RecorderStartOptions = {
  mimeType: string;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
};

export type RecordingResult = {
  blob: Blob;
  events: RecorderEvent[];
};

export type RecorderServiceOptions = {
  createMediaRecorder?: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  now?: () => number;
  onEvent?: (event: RecorderEvent) => void;
};

export class RecorderService {
  private chunks: BlobPart[] = [];
  private events: RecorderEvent[] = [];
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private mimeType = "";
  private readonly createMediaRecorder: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  private readonly now: () => number;
  private readonly onEvent?: (event: RecorderEvent) => void;

  constructor(options: RecorderServiceOptions = {}) {
    this.createMediaRecorder =
      options.createMediaRecorder ?? ((stream, recorderOptions) => new MediaRecorder(stream, recorderOptions));
    this.now = options.now ?? (() => Date.now());
    this.onEvent = options.onEvent;
  }

  start(stream: MediaStream, options: RecorderStartOptions): void {
    this.stream = stream;
    this.chunks = [];
    this.events = [];
    this.mimeType = options.mimeType;
    this.recorder = this.createMediaRecorder(stream, options);
    this.recorder.ondataavailable = (event) => {
      if (event.data.size <= 0) return;
      this.chunks.push(event.data);
      this.emit({ type: "data", timestamp: this.now(), size: event.data.size });
    };
    this.recorder.onpause = () => this.emit({ type: "pause", timestamp: this.now() });
    this.recorder.onresume = () => this.emit({ type: "resume", timestamp: this.now() });
    this.recorder.start();
    this.emit({ type: "start", timestamp: this.now() });
  }

  pause(): void {
    if (this.recorder?.state === "recording") {
      this.recorder.pause();
    }
  }

  resume(): void {
    if (this.recorder?.state === "paused") {
      this.recorder.resume();
    }
  }

  stop(): Promise<RecordingResult> {
    if (!this.recorder) {
      return Promise.resolve({ blob: new Blob(), events: [] });
    }

    return new Promise((resolve) => {
      const recorder = this.recorder!;
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || this.mimeType || undefined });
        this.emit({ type: "stop", timestamp: this.now(), size: blob.size });
        resolve({ blob, events: [...this.events] });
      };

      if (recorder.state !== "inactive") {
        recorder.stop();
      } else {
        recorder.onstop?.(new Event("stop"));
      }
    });
  }

  cleanup(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }

  private emit(event: RecorderEvent): void {
    this.events.push(event);
    this.onEvent?.(event);
  }
}
