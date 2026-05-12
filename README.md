# Streaming App

Streaming App is a local-first camera recorder with a professional control-room interface. It is designed to run as a GitHub Pages web app and as an Electron PC app with on-device MP4 review and export.

## What It Does

- Requests camera and microphone access only after the user clicks **Enable preview**.
- Records locally with `MediaRecorder`.
- Offers an explicit 30 FPS / 60 FPS capture choice before preview. The app requests the selected frame rate and reports the actual delivered/negotiated FPS when the device or browser falls back.
- Applies **AutoPatch** voice polish plus a separate **Perfect Pop Filter** for local broadcast-style plosive, crack, harshness, level, and limiting control.
- Detects the real browser recording format with `MediaRecorder.isTypeSupported()`.
- Renders a reviewed MP4 after **Stop** before download/save. Browser mode uses FFmpeg.wasm locally; Electron uses bundled native FFmpeg.
- Lets users preview the rendered MP4, revise exact trim seconds and voice polish, rerender, then download/save only the current MP4.
- Shows live audio meters, voice enhancement strength, actual stream settings, estimated file size, markers, trim range, render progress, and a quality terrain timeline.

## Privacy Model

The app has no backend and no upload workflow. Camera streams, microphone streams, recording blobs, FFmpeg render data, object URLs, markers, and export data stay on the local device. The GitHub Pages build serves static files only.

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

## MP4 Review And Export

After Stop, the app renders a local review MP4 from the captured blob, trim range, FPS target, bitrate, AutoPatch strength, and Perfect Pop Filter strength. Download/save is disabled until the latest settings have been rendered.

In the browser, FFmpeg.wasm is lazy-loaded from bundled `@ffmpeg/ffmpeg`, `@ffmpeg/util`, and single-thread `@ffmpeg/core` assets. In Electron, the secure preload bridge exposes `renderMp4` and `saveMp4`; the main process writes temporary local input/output files and runs bundled FFmpeg with argument arrays, not shell string interpolation. Temporary directories are removed after render succeeds or fails.

```bash
npm run electron:dev
```

## GitHub Pages

The included workflow deploys `dist/` from `main` to GitHub Pages. The Vite base path is set to `/Streaming-App/` when running in GitHub Actions, so the published app is prepared for:

```text
https://grogusungjinwoo.github.io/Streaming-App/
```

Enable Pages in the repository settings with **GitHub Actions** as the source.
