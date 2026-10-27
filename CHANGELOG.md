# Changelog

Every version has [installation and workspace notes](docs/releases/README.md).

## 0.9.0 — 2026-10-27

- Rebuild the website around an original procedural 3D connector scene with pointer repulsion, dragging and palette-change impulses.
- Add a scroll-driven, 32 × 32 video surface that changes from a cobalt preview to the full-color recording. Mobile and reduced-motion modes use the ordinary video surface.
- Replace the previous recording tabs with a main reel and two feature previews. Recordings still open in a fullscreen player with playback controls.
- Add a compact, reversible white-card menu. Use bundled Inter for the tour and retain Geist / MiSans in the review workspace.
- Retain the six 0.8 recording files, source-audio protection and existing review/database format.

[Changes and upgrade steps](docs/releases/0.9.0.md).

## 0.8.1 — 2026-10-27

Increase sample label sizes and contrast. Give mobile A/B controls their own row and allow action labels to wrap in larger touch targets. The 0.8.0 recordings and font files are unchanged.

[Changes and upgrade steps](docs/releases/0.8.1.md).

## 0.8.0 — 2026-10-27

Redesign the workspace and tour with Geist and MiSans, a pale lavender palette and a separate review panel. Add a playable piano sample with A/B switching, range selection, looping and a time note. Re-record the Chinese and English walkthroughs as focused clips with inline controls. Respect reduced motion and stop playback offscreen.

[Changes and upgrade steps](docs/releases/0.8.0.md).

## 0.7.1 — 2026-10-27

Restore keyboard focus after saving a time note. Keep focus in another control if the user moved there while saving.

[Changes and upgrade steps](docs/releases/0.7.1.md).

## 0.7.0 — 2026-10-27

Editable time notes, search within review text, listening-position recovery and clearer queue completion. Large libraries reuse existing rows when selecting clips. Revised local typography, intake and walkthrough, with one-shot recordings, seeking and a larger viewer. Fresh-install commands now create a workspace before starting the server.

[Changes and upgrade steps](docs/releases/0.7.0.md).

## 0.6.0 — 2026-10-26

Three recorded workflows in Chinese and English, a warm studio walkthrough and a playable preview on the empty workspace. Videos pause out of view and respect reduced motion. Includes a static-site build and the capture/encoding tools.

[Changes and upgrade steps](docs/releases/0.6.0.md).

## 0.5.0 — 2026-10-26

- Select multiple local audio files, with stable per-path IDs and repeatable rescan.
- Add timestamped notes to reviews, waveform pins, history, undo and JSON/CSV exports.
- Preserve optional annotations when an older client saves through the new server.
- Add a searchable command menu, review progress and recently-reviewed ordering.
- Rebuild the intake, import dialog, review inspector and responsive shell.
- Vendor pinned MIT-licensed Motion for native style transitions and velocity-aware springs.
- Add stable API/job error codes and matching English/Chinese messages; localize accessibility labels and chooser titles.
- Fix transform endpoints, rapid dialog reopening and waveform grab offsets.
- See [changes and upgrade instructions](docs/releases/0.5.0.md).

## 0.4.0 — 2026-10-26

- Open local folder/manifest selection windows; retain manual path entry when a chooser is unavailable.
- Replace empty queue controls and decorative artwork with two direct import actions.
- Zoom the peak overview to 8×, pan, fit the keep range, and drag or keyboard-adjust its boundaries.
- Simplify labels, typography, colour and intake transitions; keep precision edits immediate.
- Archive changes and upgrade instructions per release; refuse to build without the current release document.
- Test chooser cancellation, authorization, failure recovery, concurrency and boundary constraints.

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
