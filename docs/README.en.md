# Audio Review Desk

[中文](../README.md) · [Install](installation.md) · [Manifest format](manifests.md) · [Release notes](releases/README.md)

A local app for reviewing audio clips before they enter a dataset. Import a folder, check files that need attention, compare a reference, and save your decisions.

![Audio Review Desk — file list, playback and review controls](screenshot.png)

The screenshot uses generated test signals; no voice recordings are included.

## Start the app

**Windows:** download and unzip the [latest source release](https://github.com/FUN-ACTION/audio-review-desk/releases/latest), then double-click `start-windows.cmd`. Python 3.11+ is required. The launcher creates its own environment and opens an empty workspace.

**macOS / Linux:**

```sh
git clone https://github.com/FUN-ACTION/audio-review-desk.git
cd audio-review-desk
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/python -m audio_review_desk init --workspace review-workspace
.venv/bin/python -m audio_review_desk serve --workspace review-workspace --open
```

Choose **Audio folder** to open a local selection window. You can also enter a path. Use a CSV or JSON manifest if your clips already have recording IDs, source times, or aligned references. WAV works without extra runtime libraries. Other formats need [FFmpeg and ffprobe](installation.md#optional-ffmpeg).

## Working through a collection

| Task | Where to do it |
| --- | --- |
| Find corrupt, quiet or near-full-scale audio | **Needs attention** filter |
| Compare a processed clip with its reference | **A / B**, at the same playback position |
| Listen closely to a word or boundary | Drag the waveform, set start/end, turn on **Loop**, adjust speed |
| Keep the queue moving | **Save & continue**, or J/K to move between files |
| Mark a group for repair or exclusion | Select files, choose a status, then **Apply** |
| Recover from a wrong decision | **Undo last review**; the change stays in history |
| Hand reviewed clips to another tool | **Export → Approved audio · CSV** |
| Listen without the other panels | **Focus listening**, or F |

Batch changes preserve notes and scores. Approval is per clip. CSV exports include file hashes and source intervals; JSON also preserves the full current review record.

## What happens to your files

The app reads source audio. It writes its database and listening copies to a separate workspace; suggested cuts do not cut the source file. No account, API key, model download or network upload is needed.

If you replace a clip or its reference, the new version starts pending. Previous decisions stay attached to the old version. Concurrent edits from an older page are rejected rather than silently overwriting a newer review.

Duration totals merge overlapping clips from the same recording. Exact PCM copies have a separate deduplicated total. [Counting and precision](counting.md) explains the difference; technical flags alone do not establish identity or listening quality.

## Updates

**0.4.0:** direct folder and manifest selection, a simpler empty library, waveform zoom and pan, and draggable keep-range handles. Arrow keys adjust a focused boundary by 10 ms; hold Shift for 100 ms. Range edits are saved as review data. The waveform is a peak overview, not a sample editor.

Each release includes its own changes, installation instructions and workspace compatibility notes. See [release notes](releases/README.md) and [upgrading](installation.md#upgrading-from-01).

## Development

```sh
python -m pip install -e .
python -m unittest discover -s tests -v
node --test tests-js/*.test.mjs
```

Tests use generated audio and temporary workspaces. Node.js 22+ is only needed for frontend tests; normal use needs Python. [Verification notes](verification.md) record release checks. To try generated example files, run `audio-review-desk demo --workspace .ard-demo`, then serve that workspace.

Issues with a small reproduction are welcome. See [CONTRIBUTING.md](../CONTRIBUTING.md). The code is MIT-licensed; [bundled fonts](../THIRD_PARTY_NOTICES.md) use SIL OFL 1.1. No recordings, models or private review databases are included in the repository.
