# Release verification

Version: 0.2.0. Local verification date: 2026-10-26.

## Automated checks

- 58 Python tests cover audio decoding, PCM hashes, timeline totals, version-bound reviews, concurrent edits, atomic restore, HTTP ranges and origin checks. The 0.2 cases add append/replace imports, progress, cancellation, conflicting IDs, legacy workspace compatibility, atomic batch edits, undo, CSV filtering and spreadsheet formula escaping.
- 5 JavaScript unit tests cover queue filtering, duration formatting, score/trim payloads, sorting and playback range bounds.
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
- Folder/manifest import showed progress and completed in the app. Rescanning retained matching reviews.
- Save & next moved to the next clip; batch exclusion preserved notes and scores. Undo appended a new revision and restored the preceding decision.
- Both choices in the unsaved-draft dialog were exercised: keep editing retained the draft; discard restored the saved review.
- Loop playback started at the suggested boundary at 0.75× speed. A/B playback retained the rate and a position inside the selected range.
- Approved CSV download contained the expected reviewed row, source interval and score.
- A 390 CSS-pixel emulated viewport had no horizontal page overflow. This is not a physical-device test.

No browser test establishes subjective singing quality, correct lyrics, speaker identity, or training readiness. Synthetic test decisions are unrelated to any user's real audio collection.

## Data separation

Development and testing used newly generated signals, temporary workspaces, and a separate Python environment. Original material/model directories were not imported into the public repository. An external delivery receipt records before/after hashes for the original implementation files inspected during extraction; those private filesystem paths are not distributed in the source archive.

The existing 0.1 example workspace was backed up before development and its database hash was unchanged after the 0.2 checks. The screenshots show generated signals with illustrative review decisions, not a validated voice dataset.
