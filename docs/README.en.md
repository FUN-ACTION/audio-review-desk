# Audio Review Desk

Listen through audio collections, compare references, and save keep ranges and timestamped notes. Export reviews as CSV or JSON.

[中文](../README.md) · [Install](installation.md) · [Manifest format](manifests.md) · [0.11 changes](releases/0.11.1.md)

[![Project website](screenshot-tour.png)](https://fun-action.github.io/audio-review-desk/tour/)

[Open the website](https://fun-action.github.io/audio-review-desk/tour/) · [Workspace screenshot](screenshot.png)

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

Choose audio files, a folder, or a CSV / JSON manifest. Multiple files can be selected together. Integer PCM WAV works directly; other formats need [FFmpeg and ffprobe](installation.md#optional-ffmpeg).

## Review a collection

Find a clip on the left, listen in the middle, and save a decision on the right. Search includes filenames, review notes and time notes. Ctrl / Cmd K opens clips and common actions.

| Task | Controls |
| --- | --- |
| Compare | Switch A / B between the original and the reference in a manifest; change speed or loop a phrase |
| Annotate | Press M to add a note at the playhead; click its time to seek, or its text to edit the note and timestamp |
| Set a range | Drag the waveform edges, or press `[` / `]` to mark the playhead position |
| Decide | Approve, mark for work, or exclude; Save & continue opens the next pending clip |
| Export | Download approved clips as CSV, or save the full review as JSON; both include ranges and time notes |

Undo restores an earlier review without deleting history. Batch changes keep notes and scores; approval is per clip. Listening position, speed and volume stay in this browser. Position memory can be turned off in Help.

## Files and updates

Version 0.11 restores the lavender layout and MiSans type from 0.9. The draggable 3D scene now uses musical notes. Three generative material studies replace the software illustrations and recordings. [The release notes](releases/0.11.1.md) cover changes and upgrade steps.

Source audio is read-only. Ranges do not crop it. The separate workspace stores the database, review history and listening copies. Stop the old server, back up the **entire workspace**, install in the app's existing environment, and reopen the original path. [Every version](releases/README.md) has its own upgrade notes.

Changed audio or references start a new pending version. Use stable manifest IDs when moving files. See [counting and precision](counting.md) for source overlap and PCM comparison rules.

## Development

```sh
python -m pip install -e .
python -m unittest discover -s tests -v
node --test tests-js/*.test.mjs
```

Tests use temporary workspaces and generated signals. Scores and notes in the walkthrough illustrate the controls. Node.js 22+ is needed only for frontend tests.

See [contributing](../CONTRIBUTING.md), [verification](verification.md) and [third-party licences](../THIRD_PARTY_NOTICES.md). The application code is MIT-licensed.
