# Changelog

## 0.3.0 — 2026-10-26

- Rebuild the workspace with a library sidebar, listening editor and review inspector; add light/dark appearances and focus listening.
- Bundle Inter and Noto Sans SC subsets for consistent offline typography, with font licences and a source-pinned font build script.
- Replace native media controls with a custom player, waveform seeking, volume and five-second skips.
- Track playback with a composited playhead; paint waveforms separately from the audio clock.
- Add interruptible A/B springs, dialog/menu transitions and save feedback, including reduced-motion, contrast and transparency preferences.
- Move explanatory copy into contextual Help and simplify action labels in both languages.
- Split frontend copy, motion, waveform and transport into separate modules. Add font delivery/version checks and spring regression tests.
- Add version detection when returning to the app, so a newer running server can prompt a refresh.

## 0.2.0 — 2026-10-26

- Import folders and manifests from the app, with per-file progress and cancellation before catalog commit.
- Keep multiple collections; refresh one without removing the others. Reject ambiguous clip IDs.
- Select files for batch status changes, and undo a clip's last review without deleting history.
- Export all or approved reviews as CSV, including hashes and source intervals.
- Loop suggested ranges, change playback speed, mark boundaries at the playhead, and save-and-advance.
- Replace the landing-page layout with a compact file list and listening/review workspace.
- Start Windows users in an empty workspace; keep example audio optional.
- Correct handling of disconnected audio clients without attempting a second HTTP response.
- Build release archives and wheels from a clean copy of the committed tree, with SHA256 checksums.

## 0.1.0 — 2026-10-26

- Initial standalone Python package and command-line interface.
- Streaming audio QC, common-precision PCM hashing, source-timeline union statistics.
- Local English/Chinese listening UI with A/B previews, review history, and JSON export.
- Version-bound decisions, optimistic edit conflicts, and validated review restore.
- Synthetic demo generator, automated tests, and cross-platform CI configuration.
