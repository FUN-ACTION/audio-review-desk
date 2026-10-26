# Audio Review Desk

[中文说明](docs/README.zh-CN.md) · [Install](docs/installation.md) · [Manifest format](docs/manifests.md) · [Changelog](CHANGELOG.md)

A local app for reviewing audio clips before they enter a dataset. Import a folder, check files that need attention, compare a reference, and save your decisions.

![Audio Review Desk — file list, playback and review controls](docs/screenshot.png)

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

In the app, choose **Import audio** and enter a folder path on your computer. Use a CSV or JSON manifest if your clips already have recording IDs, source times, or aligned references. WAV works without extra runtime libraries. Other formats need [FFmpeg and ffprobe](docs/installation.md#optional-ffmpeg).

## Working through a collection

| Task | Where to do it |
| --- | --- |
| Find corrupt, quiet or near-full-scale audio | **Technical flags** filter |
| Compare a processed clip with its reference | **A / B**, at the same playback position |
| Listen closely to a word or boundary | Set start/end, turn on **Loop range**, adjust speed |
| Keep the queue moving | **Save & next**, or J/K to move between files |
| Mark a group for repair or exclusion | Select files, choose a status, then **Apply to selection** |
| Recover from a wrong decision | **Undo last review**; the change stays in history |
| Hand reviewed clips to another tool | **Export → Approved clips · CSV** |

Batch changes preserve notes and scores. Approval is per clip. CSV exports include file hashes and source intervals; JSON also preserves the full current review record.

## What happens to your files

The app reads source audio. It writes its database and listening copies to a separate workspace; suggested cuts do not cut the source file. No account, API key, model download or network upload is needed.

If you replace a clip or its reference, the new version starts pending. Previous decisions stay attached to the old version. Concurrent edits from an older page are rejected rather than silently overwriting a newer review.

Duration totals merge overlapping clips from the same recording. Exact PCM copies have a separate deduplicated total. [Counting and precision](docs/counting.md) explains the difference; technical flags alone do not establish identity or listening quality.

## Updates

**0.2.0:** import folders from the app, watch or stop a scan, keep multiple collections in one workspace, mark files in batches, undo a review, export CSV, and loop a selected range. The interface and Windows startup now open on the actual file workflow rather than the example collection.

Existing 0.1 workspaces remain readable. Stop the old server before upgrading, install the new version in the same app environment, then reopen your workspace. See [upgrading](docs/installation.md#upgrading-from-01).

## Development

```sh
python -m pip install -e .
python -m unittest discover -s tests -v
node --test tests-js/*.test.mjs
```

Tests use generated audio and temporary workspaces. Node.js 22+ is only needed for frontend tests; normal use needs Python. [Verification notes](docs/verification.md) record release checks. To try generated example files, run `audio-review-desk demo --workspace .ard-demo`, then serve that workspace.

Issues with a small reproduction are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). MIT license; no recordings, models or private review databases are included in the repository.
