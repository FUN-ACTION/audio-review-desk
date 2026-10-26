# Release verification

Version: 0.4.0. Local verification date: 2026-10-26.

## Automated checks

65 Python tests and 9 JavaScript tests pass locally. Added cases cover native chooser cancellation, Unicode paths, failure recovery, single-window locking, HTTP authorization before opening a window, zoom limits, non-crossing trim boundaries, and rejection of releases missing upgrade instructions. Existing decoding, PCM deduplication, timeline, import, review, concurrency, undo and export cases remain included.

## Browser checks

The rebuilt app was exercised in local Chromium with generated signals and a separate workspace. A selected manifest path reached the import dialog and imported successfully. A real pointer drag changed the start boundary; saving and reloading retained the edited endpoints. Keyboard boundary edits and 2× zoom updated the view and draft state. Reference playback reached the end without a media error. Light/dark appearances and a 390 CSS-pixel emulated viewport were checked. These are software checks, not physical-phone testing or a guarantee of a particular frame rate.

Chooser cancel and failure behaviour are covered by mocked subprocess/HTTP tests. The local selection helper uses optional Tk; manual path entry remains available without a graphical desktop. No test records a human listening judgment.

The existing app server was stopped before the entire user workspace was copied and each file hash compared. Test imports did not use that workspace. The older example database and the original implementation hashes are checked separately by the private publication audit.

Release packages are built from the committed tree and installed separately before publication. The GitHub Actions run linked from each Release records the exact commit's Windows, Linux, macOS and FFmpeg checks.

---

# Earlier release checks

Version: 0.3.0. Local verification date: 2026-10-26.

## Automated checks

- 59 Python tests cover audio decoding, PCM hashes, timeline totals, version-bound reviews, concurrent edits, atomic restore, HTTP ranges and origin checks. Workflow cases cover append/replace imports, cancellation, conflicting IDs, legacy workspaces, batch edits, undo and CSV. Version 0.3 adds packaged font delivery and version checks.
- 7 JavaScript tests cover filtering, formatting, review payloads, sorting, playback bounds and spring behaviour at 60/120 Hz with velocity continuity on retargeting.
- Optional FFmpeg integration exercised FLAC equivalence and MP3 decoding on the local Windows environment.
- A wheel installation and synthetic demo are verified in a separate clean virtual environment before release.

The exact supported CI matrix is Windows/Linux/macOS with Python 3.11/3.13, plus an Ubuntu FFmpeg job. The [GitHub Actions page](https://github.com/FUN-ACTION/audio-review-desk/actions) is the authority for completed hosted runs; configuration alone is not a passed run.

## Browser checks

The 0.1/0.2 local app was exercised in the ChatGPT in-app Chromium browser using generated audio:

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

The 0.3 workbench adds browser checks for the custom player, waveform seeking, a loop beginning at 0.25 seconds at 0.75×, rapid A/B switching, focus mode, both appearances, reduced-motion behaviour, packaged Chinese font usage, zero-score saving, draft protection and responsive layout. These are local Chromium checks, not physical-device testing or a claim about matching Apple's hardware performance.

## Data separation

Development and testing used newly generated signals, temporary workspaces, and a separate Python environment. Original material/model directories were not imported into the public repository. An external delivery receipt records before/after hashes for the original implementation files inspected during extraction; those private filesystem paths are not distributed in the source archive.

The existing 0.1 example workspace was backed up before development and its database hash was unchanged after the 0.3 checks. The screenshots show generated signals with illustrative review decisions, not a validated voice dataset.
