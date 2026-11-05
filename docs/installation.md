# Installation

Python 3.11+ is required. Normal usage has no third-party Python runtime dependencies. A virtual environment keeps installation independent from existing ML environments.

## Install from source

Clone the repository, run `python -m venv .venv`, then use the environment's Python:

| Platform | Install | Run |
| --- | --- | --- |
| Windows PowerShell | `.\.venv\Scripts\python.exe -m pip install .` | `.\.venv\Scripts\python.exe -m audio_review_desk --help` |
| macOS / Linux | `.venv/bin/python -m pip install .` | `.venv/bin/python -m audio_review_desk --help` |

No shell activation is necessary. To install a downloaded wheel, replace `.` with the wheel path. PyPI publication is not currently provided; use this repository or its release assets.

The build backend is setuptools 77 or newer, downloaded by pip from its configured package registry when needed. The minimum matches the package's SPDX licence metadata ([setuptools documentation](https://setuptools.pypa.io/en/latest/userguide/pyproject_config.html)). After installation, the WAV-only example can run offline. No accounts, keys, model weights, or external services are required.

## Optional FFmpeg

Obtain FFmpeg and ffprobe from an appropriate distribution linked by [ffmpeg.org](https://ffmpeg.org/download.html). Both executable files must be accessible on PATH, or supply explicit paths:

```powershell
.\.venv\Scripts\python.exe -m audio_review_desk scan 'D:\MyAudio' --workspace '.\review-workspace' --ffmpeg 'D:\Tools\ffmpeg.exe' --ffprobe 'D:\Tools\ffprobe.exe'
.\.venv\Scripts\python.exe -m audio_review_desk serve --workspace '.\review-workspace' --ffmpeg 'D:\Tools\ffmpeg.exe' --ffprobe 'D:\Tools\ffprobe.exe'
```

The executable choice is per command. Use the same tools when scanning and serving. The default decoder timeout is 120 seconds per file; increase `--timeout` for long recordings. Python's native WAV path does not use this subprocess timeout.

## Workspace layout

```text
review-workspace/
  reviews.sqlite     catalog, current decisions, historical versions
  previews/          generated PCM16 listening copies
```

Back up the entire workspace with the server stopped. Audio paths remain references to original files; audio is not copied into the database. Moving source files requires a new manifest with the same stable IDs and unchanged source metadata to preserve matching review keys.

## Starting an empty workspace

Run from the directory containing the app's existing `.venv`. No activation is needed.

Windows PowerShell:

```powershell
.\.venv\Scripts\python.exe -m audio_review_desk init --workspace .\review-workspace
.\.venv\Scripts\python.exe -m audio_review_desk serve --workspace .\review-workspace --open
```

macOS / Linux:

```sh
.venv/bin/python -m audio_review_desk init --workspace review-workspace
.venv/bin/python -m audio_review_desk serve --workspace review-workspace --open
```

Choose one or more audio files, a folder, or a manifest in the local selection window, or enter a path on the same computer as the server. The chooser uses Python's optional Tk support; if it is absent or no desktop is available, manual path entry still works. Imports run in the background. Accepted stop requests take effect at the next cancellation checkpoint, which may be within the current file but can be delayed by blocking operations; stopping is unavailable once saving begins, and the old catalog remains active until the new catalog commits.

The app keeps other collections by default. Reimporting a collection updates its members and removes missing members from the active list, while retaining historical versions. Different files with the same clip ID are rejected in append mode; give them unique IDs in a manifest or explicitly replace the active list.

## Upgrading and older workspaces

Version-specific changes and these compatibility instructions are archived for [every release](releases/README.md).

Stop every app process using the workspace, then back up the entire workspace and the original audio/reference files at their source paths. Those files are not necessarily inside the workspace.

Install the new source or wheel using the **absolute path to the app's existing virtual-environment Python** and an **explicit path to the new source directory or wheel**. Do not use a bare `python` command or assume a newly unpacked source directory contains the existing environment. The paths below are examples: replace both with your actual paths. No training environment is involved.

Windows PowerShell (the `&` invokes the quoted executable path):

```powershell
& 'D:\Apps\AudioReviewDesk\.venv\Scripts\python.exe' -m pip install --upgrade 'D:\Downloads\audio-review-desk-new'
```

macOS / Linux:

```sh
'/absolute/path/to/existing-app/.venv/bin/python' -m pip install --upgrade '/absolute/path/to/new-source'
```

For a wheel, replace the final source-directory argument with the downloaded `.whl` file's explicit path. After installation, use the same environment's Python with `-m audio_review_desk serve --workspace` and the original workspace's actual path. Keep the backup until you have verified the upgrade.

### Testing an unpublished same-version candidate

A source candidate can contain changes while still reporting the same version as an installed release. The Windows launcher checks the version and can reuse an older installation or running server, so its version check alone does not identify candidate code. For an isolated candidate check, stop the old server, unpack the candidate in a separate directory, create a fresh virtual environment there, and install that source into it. Invoke that environment's Python directly rather than the launcher. Use a new disposable workspace and an unused port, and verify the printed URL before opening it. Keep the existing workspace and its backup separate. This is a verification procedure, not a release or upgrade instruction.

Existing databases and review keys remain valid; no tables are dropped. The Windows launcher now uses `review-workspace` instead of `.ard-demo`. To reopen an older workspace from the directory containing the app's existing `.venv`:

Windows PowerShell:

```powershell
.\.venv\Scripts\python.exe -m audio_review_desk serve --workspace .\.ard-demo --open
```

macOS / Linux:

```sh
.venv/bin/python -m audio_review_desk serve --workspace .ard-demo --open
```

Here `.ard-demo` is relative to the current directory. If the original workspace is elsewhere, supply its actual path; a new directory with the same name does not recover its data. A source imported through the 0.1 interface may need importing once before the new Rescan button is available.

The workspace stores collection membership from 0.2 onward. Earlier catalog rows have no membership tag, so an appended first rescan preserves legacy rows that it cannot confidently associate. An explicit replace import can refresh the whole active list without deleting history.

## Troubleshooting

- **No supported files:** only supported audio extensions are scanned. Symbolic-link files are skipped; no audio is downloaded.
- **FFmpeg not found:** integer PCM WAV still works. Install both optional tools or set their paths.
- **Source changed:** rescan/reimport; old scores cannot automatically validate replacement audio.
- **Unexpectedly short compressed audio:** a clean packet-boundary truncation can decode successfully, so decoding alone cannot prove a recording is complete. Compare the clip with the expected duration or an independently supplied original checksum when completeness matters.
- **Another page updated:** copy your unsaved note, refresh, and reconcile with the newer saved decision.
- **Port already used:** pass `--port 8766` and use the new printed URL. Use `127.0.0.1`, not a LAN address or hostname.
- **No sound:** prepare a preview by pressing play, check your system audio, and check the technical error message. The first preview of a large file can take time.
- **Export file already exists:** choose a new filename. The CLI intentionally does not overwrite existing files.
- **Out of disk space:** stop every app process using the workspace. Before removing anything, copy the **entire workspace** to a different location with enough free space and verify that the backup is readable and complete. Original audio and reference files are stored at their source paths, not necessarily inside the workspace; back them up separately. Generated listening copies are under `<workspace>/previews/` as `<review-key>-a.wav` and `<review-key>-b.wav`. Consider removing only identified generated copies whose regeneration you have verified in a disposable workspace copy, with enough free space, the matching readable source and reference files, and the required decoder tools. The app checks source versions before using or recreating previews; missing, unreadable or changed sources can prevent regeneration. Keep any copy you cannot confirm is replaceable. Do not delete the database, review history, original audio or reference files to clear the preview cache.

## Version 0.5 time notes

Time notes are optional fields in the existing review JSON. Existing databases and keys stay valid. When an older page sends no annotation field to the new server, current notes are retained. Older installed servers do not understand the new field and may omit it when rewriting a review, so keep a full backup before downgrading. See [0.5 upgrade notes](releases/0.5.0.md).


## Version 0.6 walkthrough

The empty workspace has a click-to-play recording. Open the full walkthrough from that preview or from keyboard help. Videos and posters are included in the wheel and work without external media services. The separate public walkthrough is a static site; it has no connection to a local workspace. See [0.6 upgrade notes](releases/0.6.0.md).


## Version 0.7 listening memory

Playback position, speed, volume and loop preference are stored in this browser for the current workspace. Reloading does not start audio automatically. Position memory can be turned off in Help, which clears saved positions. Reviews, ranges and annotations remain in the workspace database regardless of that preference. A different browser or server port has separate browser storage.

The walkthrough now uses direct application recordings, with replay, seeking and a larger viewer. Its videos are illustrations of the workflow; they do not contain a user's imported files. See [0.7 changes and upgrade steps](releases/0.7.0.md).
