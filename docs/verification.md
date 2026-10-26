# Release verification

Version: 0.1.0. Local verification date: 2026-10-26.

## Automated checks

- 40 Python tests cover PCM width conversion, container-independent hashes, silence and peak warnings, full-frame decode checks, source preservation, timeline unions, trim suggestions, version changes, reference changes, zero scores, concurrent edits, atomic restore, stale exports, HTTP byte ranges, loopback/Host/origin checks, packaged assets, CSV import, and CLI export protection.
- 3 JavaScript unit tests cover queue selection, duration formatting, and score/trim payloads.
- Optional FFmpeg integration exercised FLAC equivalence and MP3 decoding on the local Windows environment.
- A wheel installation and synthetic demo are verified in a separate clean virtual environment before release.

The exact supported CI matrix is Windows/Linux/macOS with Python 3.11/3.13, plus an Ubuntu FFmpeg job. The [GitHub Actions page](https://github.com/FUN-ACTION/audio-review-desk/actions) is the authority for completed hosted runs; configuration alone is not a passed run.

## Browser checks

The local app was exercised in the ChatGPT in-app Chromium browser using generated audio:

- Playback loaded a two-second WAV with no media error.
- A/B changed to the reference stream and retained a usable time position.
- A score of zero saved correctly and remained after a page reload.
- Two pages editing the same revision produced a visible conflict; the stale draft remained on screen.
- Review history displayed both saved revisions.
- Chinese labels and the technical-flags queue were checked.
- A 390 CSS-pixel emulated viewport had no horizontal page overflow. This is not a physical-device test.

No browser test establishes subjective singing quality, correct lyrics, speaker identity, or training readiness. Synthetic test decisions are unrelated to any user's real audio collection.

## Data separation

Development and testing used newly generated signals, temporary workspaces, and a separate Python environment. Original material/model directories were not imported into the public repository. An external delivery receipt records before/after hashes for the original implementation files inspected during extraction; those private filesystem paths are not distributed in the source archive.
