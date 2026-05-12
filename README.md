# Streaming App

Streaming App is a local-first camera recorder with a professional control-room interface. It is designed to run as a GitHub Pages web app and as an Electron PC app with guaranteed MP4 export.

## What It Does

- Requests camera and microphone access only after the user clicks **Enable preview**.
- Records locally with `MediaRecorder`.
- Detects the real browser recording format with `MediaRecorder.isTypeSupported()`.
- Downloads the correct web format: MP4 where supported, WebM fallback where MP4 is unavailable.
- Reuses the same React UI in Electron for desktop-grade MP4 export through bundled FFmpeg.
- Shows live audio meters, actual stream settings, estimated file size, markers, trim range, and a quality terrain timeline.

## Privacy Model

The app has no backend and no upload workflow. Camera streams, microphone streams, recording blobs, object URLs, markers, and export data stay on the local device. The GitHub Pages build serves static files only.

## Development

```bash
npm install
npm run dev
```

Open the local Vite URL and use **Enable preview** to grant device permission.

## Tests And Builds

```bash
npm test
npm run build
npm run electron:build
```

## Desktop MP4 Export

The Electron app exposes a secure preload bridge named `window.streamingApp`. The renderer sends the recorded blob bytes to the main process, which writes a temporary local input file and runs bundled FFmpeg with argument arrays, not shell string interpolation. The temporary directory is removed after export succeeds or fails.

```bash
npm run electron:dev
```

## GitHub Pages

The included workflow deploys `dist/` from `main` to GitHub Pages. The Vite base path is set to `/Streaming-App/` when running in GitHub Actions, so the published app is prepared for:

```text
https://grogusungjinwoo.github.io/Streaming-App/
```

Enable Pages in the repository settings with **GitHub Actions** as the source.

