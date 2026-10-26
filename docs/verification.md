# Release verification

Version 0.5.0 · 2026-10-26

## Automated checks

74 Python tests cover decoding, PCM comparisons, source intervals, optimistic conflicts, import/restore transactions, and review history. New cases cover individual-file selection, stable IDs for same-named files, file-list rescan, timestamped notes in CSV/JSON, undo, legacy clients and validation failures. No new database table or column is required.

15 JavaScript tests cover filtering, review payloads, range/viewport bounds, recent-review ordering, command search, independent note drafts, both languages and all known error codes. The pinned Motion bundle is hash-checked. Spring generators are sampled at 60 and 120 Hz; this is an algorithm check, not a device frame-rate claim.

## Browser checks

Local Chromium checks used generated signals in a separate workspace:

- The reported source/workspace conflict appeared in Chinese and English. A Chinese out-of-range score used a Chinese validation message.
- Multiple file paths imported together. A manifest from the earlier example collection also imported, with explicit replacement of the active list.
- Notes at zero and the end of a clip saved and survived reload. Clicking a note sought the player to its time. CSV and JSON carried the annotations; path export stayed off.
- Undo restored the previous note state. Keep-editing retained an unsubmitted note; discard allowed navigation without saving it.
- Command search selected the matching file. Ctrl+K opened the menu and Escape closed it.
- Rapid dialog close/reopen retained a full-size surface. Reduced motion opened a visible dialog without a transform.
- A drag started five pixels off the handle centre. A 60 px move predicted 0.427165 seconds and produced 0.427 seconds, preserving the grab offset.
- Rescan retained saved notes. Reference playback ended without a media error. Both appearances were inspected.
- A 390 CSS-pixel viewport had no horizontal overflow. This was a layout check, not a physical-phone or touch test.
- Chromium reported Microsoft YaHei UI for the Chinese section label. Inter and the Noto fallback remain bundled.

Native chooser protocol, cancellation and failure recovery use mocked subprocess/HTTP tests. A graphical chooser depends on the optional Tk support of the installed Python; manual paths remain available. No check establishes a human listening judgment.

## Release and data checks

The release page links the CI run for its exact commit across Windows, Linux, macOS, Python 3.11/3.13 and FFmpeg. Before publishing, build archives from the committed tree, install the wheel in a separate environment, and compare installed resource bytes with the wheel.

The original app server was stopped and its entire workspace copied before development. Test imports used another workspace. A private delivery receipt checks the backup, existing example database, original implementation hashes and downloaded release assets. No source recordings or models are included in the repository.

[Earlier release checks](verification-0.4.md)
