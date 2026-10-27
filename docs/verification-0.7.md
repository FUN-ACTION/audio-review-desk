# Release verification

Version 0.7.1 · 2026-10-27

## Automated checks

82 Python tests and 32 JavaScript tests pass locally. The suite covers decoding, review versions, conflict handling, import cancellation, history, export/restore and source protection. New checks cover editable note times, dirty-state comparison, queue continuation, listening-memory validation and workspace separation, bundled font hashes/character coverage, media manifests, crop bounds and retention of the recording's final still frame.

Tests use temporary workspaces and procedural signals. Optional FFmpeg tests run when their required tools are available. The CI matrix runs Python 3.11 and 3.13 on Windows, Linux and macOS, plus a separate FFmpeg job. The release page links the run for its exact commit.

## Browser checks

Local Chromium was used with separate empty, populated and 2500-item test workspaces:

- Restore focus to the edited time note after keyboard save, including command-menu save after changing its sort position; keep another control focused if the user moved there during the request.
- Add a note, change its text and timestamp, reject an out-of-range timestamp, cancel an edit, save, search its text and seek back to it.
- Match several search terms across file labels and saved notes. Empty filters retain the current draft and offer a clear-filters action.
- Save and continue through pending clips, preserve a zero score, and show the completed-batch export view. The completion view survives a language change.
- Reload a paused player and recover its position and speed. Browser storage failures are covered separately in unit tests.
- Keep a stale page's draft after a conflict, then verify Keep editing and discard/refresh paths.
- Show the nested-workspace import error in Chinese without changing the catalog. Block the initial state request, display a reconnect action and disable mutations, then reconnect successfully.
- Reuse existing library nodes when selecting among 2500 items. A partial pre-fix attempt timed out while rebuilding rows; after reuse, repeated selections retained node identity. This is a local stress check, not a cross-device performance claim.
- Check both tour languages and app layout from 320 to 1536 CSS pixels, plus a narrow-screen settings menu and the app's dark appearance. These are viewport checks, not a physical-phone or cross-browser certification.
- Stop automatic footage for reduced motion, allow explicit play, retain manual pause during keyboard seeking, recover from a blocked media request, and replay a completed film in the larger viewer. Closing the viewer restores focus.
- Show verified video duration before downloading a film. Check all six encoded files for H.264, yuv420p, 30 fps and no audio track; their durations match the captured timeline within one frame.

Actual rendered fonts were inspected. The Chinese headline used bundled Noto Sans SC Medium; Latin display text used Manrope. Font fallbacks no longer put Windows UI Bold ahead of the bundled Chinese face.

## Packages and preservation

Release archives are built from the committed tree. The release gate installs the wheel in a separate environment, compares installed package bytes, runs the Python suite and checks a fresh empty-workspace start. The standalone site copies only page code, media, fonts and licences.

Before the local upgrade, stop the old server and back up the entire workspace. Compare the backup, current workspace and legacy database afterward. Original source recordings and models stay outside the repository. Private delivery receipts hold local paths and preservation checks; they are not part of the public package.

[0.6 checks](verification-0.6.md) · [0.5 checks](verification-0.5.md) · [Media provenance](showcase-media.md)
