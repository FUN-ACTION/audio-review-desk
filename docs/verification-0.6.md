# Release verification

Version 0.6.0 · 2026-10-26

## Automated checks

77 Python tests and 20 JavaScript tests pass locally. This includes the previous decoding, versioning, conflict and annotation cases, plus walkthrough byte-range delivery, static-route boundaries, standalone-site packaging, and protection against overwriting a populated recording destination. Tests use temporary workspaces and generated signals.

Frontend cases cover reduced motion, data saving, explicit play/pause, hidden-page and off-screen pauses, selecting one visible clip, bounded media paths and both languages. A media audit checks all six files: H.264, yuv420p, no audio track, and 30 fps encoding. The original capture cadence is retained rather than advertised as a device frame rate.

## Browser checks

Local Chromium was used with separate empty and generated-signal workspaces:

- The new empty view displays source choices and a video preview. It waits for a click, plays, pauses and changes to the English recording with the language selector.
- The walkthrough plays a visible close-up and pauses the off-screen workflow recording. Its manual pause survives changing the page language.
- Chinese and English video sources, posters, headings and control labels change together. The English notes recording was loaded and played.
- Reduced-motion emulation left all three videos paused after reload. The temporary override was cleared.
- At 390 CSS pixels, the empty view and walkthrough had no horizontal overflow. Viewport overrides were cleared. This is a layout check, not a physical-phone or touch test.
- Captures were inspected for readable notes, actual playback movement, range dragging, source changes and save/next behaviour. The public GIF is a short composition of the same recording and original background.
- Browser console checks found no script errors. The server handles browser-aborted media requests without trying to send a second response.

The recordings use generated test signals. Their scores and decisions illustrate controls, not human acceptance of recordings. Native file-picker testing remains described in the earlier verification record.

## Packages and preservation

Release archives are built from committed source, then the wheel is installed in a separate environment and its packaged bytes checked. The release page links the seven CI jobs for that exact commit. The static walkthrough has a separate deployment workflow; its build copies only bundled media, fonts, licences and page code.

Before upgrading the local app, stop the old server and back up its entire workspace. The private delivery receipt compares the final workspace backup, legacy database, original implementation hashes and downloaded release assets. No original audio or models are copied into the project.

[0.5 checks](verification-0.5.md) · [0.4 checks](verification-0.4.md) · [Media provenance](showcase-media.md)
