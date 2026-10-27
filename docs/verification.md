# Release verification

Version 0.8.0 · 2026-10-27

## Automated checks

82 Python tests and 36 JavaScript tests pass locally. Python coverage includes source protection, decoding, import cancellation, review versions, history, conflicts, export/restore and release files. Frontend coverage includes review payloads, queue continuation, time notes, playback memory, recording policy and the new procedural sample.

The sample tests verify finite audio with headroom and matching RMS levels, waveform bins, seek bounds and the minimum selectable interval. Font checks verify packaged bytes and Chinese character coverage. The server tests request the new fonts, licence, styles and sample modules through the same static-file boundary as the app. Media tests verify all six video/poster hashes, capture duration and the final still-frame hold.

Tests use temporary workspaces and generated signals. Optional FFmpeg cases run when tools are available. CI uses Python 3.11 and 3.13 on Windows, Linux and macOS, plus one FFmpeg job; the release links the result for its exact commit.

## Browser inspection

The new source UI was checked in local Chromium with separate empty and populated workspaces:

- Play the homepage sample, switch A/B and leave a note. Audio starts from a click.
- Adjust both range edges with pointer and keyboard input; retain the minimum interval. Home and End work on the handles.
- Add a note at zero seconds, change language without losing typed text, close it with Escape and return focus. Hidden notes are inert.
- Keep the introduction paused for reduced motion; allow explicit replay. Pause playback when its area leaves view.
- Switch recording tabs, stop the previous video, seek, replay and open the larger viewer. The language switch uses the matching recordings.
- Save a real workspace note, reload and retain it. Save & continue reaches the next pending file.
- Inspect the new light/dark surfaces, collapsed mobile library and settings menu. Reject an import containing its own workspace with a Chinese error, without adding files.
- Inspect Chinese and English tour layouts at 320, 390, 768, 1024 and 1440 CSS pixels. Check the populated app at the same widths. Narrow English labels and the 320-pixel toolbar received separate fixes.

Actual font rendering was inspected: Geist for Latin display text and MiSans Regular for Chinese. These are Chromium viewport checks, not physical-phone or cross-browser certification. No claim is made about a constant frame rate across devices.

## Packaging and existing workspaces

Build archives from the committed tree, install the wheel in a separate environment, compare its packaged files and run the Python suite there. The compatibility check opens a copy of a populated 0.6 workspace, retains all tables, review keys, scores, notes and history, and exercises edit/undo on that copy.

The local upgrade uses the app's existing virtual environment after the old server stops and the entire workspace is backed up. Private receipts record file hashes before and after, installed bytes and the unchanged legacy database. Original recordings and models remain outside the repository.

[0.7 checks](verification-0.7.md) · [0.6 checks](verification-0.6.md) · [Media provenance](showcase-media.md) · [Font maintenance](fonts.md)
