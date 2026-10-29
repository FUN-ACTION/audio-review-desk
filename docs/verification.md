# Verification — 0.13.0

The current test and package results are recorded against the release commit. The checks below describe the scope, not a visual quality score.

## Automated checks

The Python suite covers decoding, collection import, deduplication, review persistence, source-file protection, localization and packaged HTTP resources. Frontend tests cover the original playback and review tools plus FFT frequency/amplitude, silence, bounded decoding, stale asynchronous requests, range audition and graphics lifecycle.

A separate private DOM harness loads the actual workspace HTML and JavaScript with controlled synthetic data. It checks startup, languages, spectrum/variant switching, quick notes, quiet-edge suggestions, audition, save and session counts. Canvas, media, WebAudio and geometry are simulated. This is not browser rendering or visual acceptance.

The spectrogram analyzes real preview PCM on demand: at most 32 MiB, the first 120 seconds and up to eight channels. Its absolute dBFS color scale is not normalized per source. The waveform and spectrum share a time axis; an oversized or unsupported source shows a useful status instead of invented data.

## Browser and appearance

Local browser control was disabled in Work settings during this revision. No current browser screenshots, physical-device tests, listening-quality ratings or 60fps measurements have been claimed. The 0.12 browser observations remain in [their historical record](verification-0.12.md) and do not validate this redesign.

## Packaging and upgrade

The release procedure builds from a clean commit, installs source and wheel separately, checks their bytes, and verifies a populated older workspace copy. CI must pass on Windows, macOS and Linux, including Python 3.11/3.13 and FFmpeg. The published website and downloaded release assets are compared with the verified package.

Before an in-place application upgrade, the complete active and legacy workspaces are backed up with file hashes and SQLite table/row snapshots. The original audio project and model environment are outside this work.

[Artwork](artwork.md) · [Media](showcase-media.md) · [Upgrade notes](releases/0.13.0.md)
