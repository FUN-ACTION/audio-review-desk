# Audio Review Desk

Review audio collections on your computer. Import files, folders or a manifest, listen to each clip, and save scores, issues, keep ranges and timestamped notes. Export the results as CSV or JSON.

[中文](../README.md) · [Install](installation.md) · [Manifest format](manifests.md) · [Release notes](releases/README.md)

[Project website](https://fun-action.github.io/audio-review-desk/tour/) · [Download](https://github.com/FUN-ACTION/audio-review-desk/releases/latest)

## Start

On Windows, unzip the [latest source release](https://github.com/FUN-ACTION/audio-review-desk/releases/latest) and run `start-windows.cmd`. Python 3.11 or newer is required.

On macOS or Linux:

```sh
git clone https://github.com/FUN-ACTION/audio-review-desk.git
cd audio-review-desk
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/python -m audio_review_desk init --workspace review-workspace
.venv/bin/python -m audio_review_desk serve --workspace review-workspace --open
```

Choose audio files, a folder, or a CSV / JSON manifest. You can select several files at once. Integer PCM WAV works directly; other formats need [FFmpeg and ffprobe](installation.md#optional-ffmpeg).

## Review

The workspace has a library, a listening area and a review panel. Search matches filenames, review notes and time notes. Ctrl / Cmd K opens clips and common actions.

| Task | Controls |
| --- | --- |
| Compare | Switch A / B between the original and the reference in a manifest; change speed or loop a phrase |
| Annotate | Press M to add a note at the playhead; click its time to seek, or its text to edit the note and timestamp |
| Set a range | Drag the waveform edges, or press `[` / `]` to mark the playhead position |
| Decide | Approve, mark for work, or exclude; Save & continue opens the next pending clip |
| Export | Export approved reviews as CSV, or the full review as JSON; both include ranges and time notes |

Undo restores the previous review while keeping its history. Batch changes preserve notes and scores; approval is per clip. This browser remembers listening position, speed and volume. Position memory can be turned off in Help.

## Files and updates

Source audio is read-only. Keep ranges do not crop files. A separate workspace stores the database, review history and listening copies.

Before upgrading, stop the old server and back up the **entire workspace**. Install the update in the app's existing virtual environment, then reopen the original workspace path. [Each release](releases/README.md) includes its changes and upgrade commands.

Changed audio or references start a new pending version. Use stable manifest IDs when moving files. See [counting and precision](counting.md) for source overlap and PCM comparison rules.

## Website artwork

The website uses three original CGI-style images with live WebGL motion. You can play the generated piano phrase or choose a local audio file to influence the animation. Playback starts when you press Play; selected files stay in the browser. See [artwork](artwork.md) and [media notes](showcase-media.md) for the source files and implementation.

## Development

```sh
python -m pip install -e .
python -m unittest discover -s tests -v
node --test tests-js/*.test.mjs
```

Tests use temporary workspaces and generated signals. Node.js 22+ is only needed for frontend tests.

For bug reports, include reproduction steps and a small sample you can share. See [contributing](../CONTRIBUTING.md), [verification](verification.md) and [third-party licences](../THIRD_PARTY_NOTICES.md). The application code is MIT-licensed.
