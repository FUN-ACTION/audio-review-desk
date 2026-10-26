# Installation

Python 3.11+ is required. Normal usage has no third-party Python runtime dependencies. A virtual environment keeps installation independent from existing ML environments.

## Install from source

Clone the repository, run `python -m venv .venv`, then use the environment's Python:

| Platform | Install | Run |
| --- | --- | --- |
| Windows PowerShell | `.\.venv\Scripts\python.exe -m pip install .` | `.\.venv\Scripts\python.exe -m audio_review_desk --help` |
| macOS / Linux | `.venv/bin/python -m pip install .` | `.venv/bin/python -m audio_review_desk --help` |

No shell activation is necessary. To install a downloaded wheel, replace `.` with the wheel path. PyPI publication is not currently provided; use this repository or its release assets.

The build backend is setuptools, downloaded by pip from its configured package registry when needed. After installation, the WAV-only demo can run offline. No accounts, keys, model weights, or external services are required.

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

## Troubleshooting

- **No supported files:** only supported audio extensions are scanned. Symbolic-link files are skipped; no audio is downloaded.
- **FFmpeg not found:** integer PCM WAV still works. Install both optional tools or set their paths.
- **Source changed:** rescan/reimport; old scores cannot automatically validate replacement audio.
- **Another page updated:** copy your unsaved note, refresh, and reconcile with the newer saved decision.
- **Port already used:** pass `--port 8766` and use the new printed URL. Use `127.0.0.1`, not a LAN address or hostname.
- **No sound:** prepare a preview by pressing play, check your system audio, and check the technical error message. The first preview of a large file can take time.
- **Export file already exists:** choose a new filename. The CLI intentionally does not overwrite existing files.
- **Out of disk space:** stop the server, back up the database, and remove generated preview copies if necessary. They can be regenerated; do not remove original audio to clear a workspace cache.
