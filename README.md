# Audio Review Desk

**Local audio quality checks and a listening review queue that keeps decisions attached to the right audio version.**

[简体中文](docs/README.zh-CN.md) · [Installation](docs/installation.md) · [Manifest format](docs/manifests.md) · [How counts work](docs/counting.md) · [Contributing](CONTRIBUTING.md)

![Audio Review Desk showing a synthetic audio workspace](docs/screenshot.png)

Use it to inspect speech or singing clips before assembling a dataset: find corrupt files, flag silence and near-full-scale samples, compare an aligned reference, record listening decisions, and export a portable review record. It runs on your computer and does not need an account, an API key, a GPU, or a model download.

## What it does

- Streams a full decode and reports sample rate, channels, peak, RMS, quiet edges, and technical flags.
- Finds identical decoded PCM in a documented common comparison format, even when container bytes differ.
- Offers A/B listening copies with constant attenuation for RMS matching. Sources are never rewritten.
- Stores scores, issue labels, trim suggestions, and append-only review history in a separate SQLite workspace.
- Resets the current review when audio, reference, eligibility, or source interval changes. Old history remains in the database.
- Counts source timeline overlaps once and distinguishes candidates from explicit human approvals.
- Provides English and Simplified Chinese interfaces, filters, keyboard controls, audio seeking, and JSON export/restore.

## Try the synthetic demo

Requires Python 3.11 or later. Create a dedicated virtual environment; keep it separate from training or inference environments.

```sh
git clone https://github.com/FUN-ACTION/audio-review-desk.git
cd audio-review-desk
python -m venv .venv
```

**Windows PowerShell** (activation is not required):

```powershell
.\.venv\Scripts\python.exe -m pip install .
.\.venv\Scripts\python.exe -m audio_review_desk demo --workspace .ard-demo
.\.venv\Scripts\python.exe -m audio_review_desk serve --workspace .ard-demo --open
```

**macOS / Linux**:

```sh
.venv/bin/python -m pip install .
.venv/bin/python -m audio_review_desk demo --workspace .ard-demo
.venv/bin/python -m audio_review_desk serve --workspace .ard-demo --open
```

Open **http://127.0.0.1:8765/**. The demo generates its own tones, silence, overlap examples, an unreadable file, and a pair with equal PCM but different WAV container bytes. It never downloads or uses recorded voices. Demo creation refuses to overwrite a nonempty directory.

## Analyze your audio

After installation, use the environment's `audio-review-desk` executable, or `python -m audio_review_desk` with that environment's Python.

```sh
audio-review-desk scan /path/to/audio --workspace /path/to/review-workspace
audio-review-desk serve --workspace /path/to/review-workspace
```

The workspace must be **outside** the scanned directory. The tool opens source files only for reading. Analysis results, the database, and generated listening copies stay in the workspace. It has no training, source deletion, or source modification command.

PCM WAV works with Python's standard library. FLAC, MP3, M4A, OGG, Opus, AIFF, and other WAV encodings need optional **FFmpeg and ffprobe** on `PATH`. You can also supply `--ffmpeg /path/to/ffmpeg --ffprobe /path/to/ffprobe` to both the import/scan and serve commands. Binaries are not bundled or downloaded automatically.

For existing clips with recording timelines or A/B references, [import a manifest](docs/manifests.md):

```sh
audio-review-desk import clips.csv --workspace review-workspace
audio-review-desk export --workspace review-workspace --output reviews.json
audio-review-desk restore reviews.json --workspace review-workspace
```

Exports omit the explicit absolute file-path fields by default. Labels and notes are user content: review them before sharing. `--include-paths` is an explicit opt-in. Export creates a new file and refuses to overwrite an existing one. Restore validates matching current version keys and appends an `imported_review` history entry; a rejected batch leaves existing reviews unchanged.

## Listening workflow

1. Scan a folder or import a manifest. Technical flags help choose what to inspect; they do not approve anything.
2. Select a clip. Listen to A, then B if you supplied a time-aligned reference.
3. Choose **Approved**, **Needs work**, **Excluded**, or **Pending**. Score and notes are optional. A score of zero is valid.
4. Save. Another tab editing the same review produces a conflict, so a stale tab cannot overwrite newer decisions.
5. Export the reviewed catalog. Keep the original workspace for full history, including inactive audio versions.

Suggested trim boundaries affect duration statistics after saving; they do not cut any file. Existing source files are hash-checked before saving a review or serving a preview. If a source changed, rescan it before proceeding.

Keyboard shortcuts outside form controls: **Space** play/pause, **B** compare, **J/K** next/previous clip. **Ctrl+Enter** saves the current form.

## Scope and limits

This is an **alpha release** for single-user, local datasets. It is not a multi-user annotation server. It binds only to `127.0.0.1`, serves packaged assets and catalog audio only, and has no remote hosting mode or telemetry.

The PCM hash compares decoded **signed 32-bit integer PCM**, with the sample rate and channel count included. It does not resample, downmix, fingerprint performances, or establish that two different recordings contain the same singer. Float audio is quantized by the optional decoder to this comparison precision; see [counting and precision](docs/counting.md). Near-full-scale detection is a threshold warning, not proof of clipping. RMS matching is not a perceptual loudness measurement.

Technical success does not establish intelligibility, recording identity, copyright permission, clean vocals, or training readiness. Large previews are prepared locally on first playback, which may take time. Human listening remains necessary.

## Development and tests

```sh
python -m pip install -e .
python -m unittest discover -s tests -v
node --test tests-js/*.test.mjs
```

The Python tests use temporary directories and generated signals. Optional FFmpeg integration tests skip when FFmpeg is absent. JavaScript unit tests need Node.js 22+; Node.js is not required to use the app. CI runs the core tests across Windows, Linux, and macOS, and a separate FFmpeg job exercises compressed input. See [verification notes](docs/verification.md) for the checks actually performed on this release.

## License and origin

MIT. This standalone implementation grew out of practical audio dataset QA and listening review workflows. It includes no model weights, third-party song recordings, private review databases, or training pipeline. FFmpeg is an optional external program with its own licensing. No upstream speech or singing model code is vendored.
