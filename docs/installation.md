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

```sh
audio-review-desk init --workspace review-workspace
audio-review-desk serve --workspace review-workspace --open
```

Choose one or more audio files, a folder, or a manifest in the local selection window, or enter a path on the same computer as the server. The chooser uses Python's optional Tk support; if it is absent or no desktop is available, manual path entry still works. Imports run in the background. Stop requests take effect after the current file finishes; the old catalog remains active until the new catalog commits.

The app keeps other collections by default. Reimporting a collection updates its members and removes missing members from the active list, while retaining historical versions. Different files with the same clip ID are rejected in append mode; give them unique IDs in a manifest or explicitly replace the active list.

## Upgrading and older workspaces

Version-specific changes and these compatibility instructions are archived for [every release](releases/README.md).

Stop the old server and back up its entire workspace. Install the new source or wheel in the app's existing virtual environment with `python -m pip install --upgrade .` (or the new wheel path). No training environment is involved.

Existing databases and review keys remain valid; no tables are dropped. The Windows launcher now uses `review-workspace` instead of `.ard-demo`. To reopen an older workspace, run `audio-review-desk serve --workspace .ard-demo --open` or supply its original path. A source imported through the 0.1 interface may need importing once before the new Rescan button is available.

The workspace stores collection membership from 0.2 onward. Earlier catalog rows have no membership tag, so an appended first rescan preserves legacy rows that it cannot confidently associate. An explicit replace import can refresh the whole active list without deleting history.

## Troubleshooting

- **No supported files:** only supported audio extensions are scanned. Symbolic-link files are skipped; no audio is downloaded.
- **FFmpeg not found:** integer PCM WAV still works. Install both optional tools or set their paths.
- **Source changed:** rescan/reimport; old scores cannot automatically validate replacement audio.
- **Another page updated:** copy your unsaved note, refresh, and reconcile with the newer saved decision.
- **Port already used:** pass `--port 8766` and use the new printed URL. Use `127.0.0.1`, not a LAN address or hostname.
- **No sound:** prepare a preview by pressing play, check your system audio, and check the technical error message. The first preview of a large file can take time.
- **Export file already exists:** choose a new filename. The CLI intentionally does not overwrite existing files.
- **Out of disk space:** stop the server, back up the database, and remove generated preview copies if necessary. They can be regenerated; do not remove original audio to clear a workspace cache.

## Version 0.5 time notes

Time notes are optional fields in the existing review JSON. Existing databases and keys stay valid. When an older page sends no annotation field to the new server, current notes are retained. Older installed servers do not understand the new field and may omit it when rewriting a review, so keep a full backup before downgrading. See [0.5 upgrade notes](releases/0.5.0.md).


## Version 0.6 walkthrough

The empty workspace has a click-to-play recording. Open the full walkthrough from that preview or from keyboard help. Videos and posters are included in the wheel and work without external media services. The separate public walkthrough is a static site; it has no connection to a local workspace. See [0.6 upgrade notes](releases/0.6.0.md).


## Version 0.7 listening memory

Playback position, speed, volume and loop preference are stored in this browser for the current workspace. Reloading does not start audio automatically. Position memory can be turned off in Help, which clears saved positions. Reviews, ranges and annotations remain in the workspace database regardless of that preference. A different browser or server port has separate browser storage.

The walkthrough now uses direct application recordings, with replay, seeking and a larger viewer. Its videos are illustrations of the workflow; they do not contain a user's imported files. See [0.7 changes and upgrade steps](releases/0.7.0.md).
