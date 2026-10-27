# Release verification

Version 0.10.0 · 2026-10-27

## Automated checks

96 Python tests and 61 JavaScript tests pass locally. New coverage includes score motion with stable elapsed-time steps, finite note positions, pointer response, range bounds and edge selection, and audio-clock rebasing after a loop has wrapped. The clock regression checks that changing a loop from 2–8 seconds to 3–7 keeps an audible position of 4 seconds at 4.

The type tests bind all shipped font and complete licence bytes to pinned sources, check interface coverage, and reject missing or changed font-build input. The maintainer builder checks actual cmaps and variable axes. The small Noto Sans SC presentation subset was also compared at weights 400, 500, 600 and 700: all 1,548 checked outlines match the broad workspace file.

Server/build tests cover every new Canvas/SVG/example/font asset, platform-independent MIME types, strict file boundaries and absence of private audio or databases in the static build. A recursive module-graph test rejects Three.js or the video-warp module in the new page's dependencies. Retained legacy assets remain testable for older pages.

All six recordings were recaptured in the 0.10 application. Media tests verify their hashes, posters, dimensions and capture duration, including the final static hold. Recordings use separate generated-signal workspaces; no original recordings or models are used.

CI runs Python 3.11 and 3.13 on Windows, Linux and macOS plus a separate FFmpeg job. The release links results for its exact commit. Optional decoder/encoder cases may be skipped where tools are absent; the local final run has no skips.

## Browser inspection

The page was exercised in Chromium using actual controls and generated audio:

- Pluck a note, play the piano phrase, pause motion, open/reverse/close the menu and check keyboard focus.
- Compare the actual A/B sample buffers without losing position. Move a range with the keyboard and pointer; loop it and retain its boundaries.
- Add and remove a time marker. Change mode and language while retaining range and markers. Example actions stay separate from collection reviews.
- Inspect Chinese and English at 320, 390, 768, 1024 and 1440 CSS pixels. Check phone hit areas and desktop baselines; the shorter desktop layout keeps the sample controls in the first screen.
- Open new full-frame recordings, play, seek and close them. Use the matching language source. Read back saved notes/ranges after reloading each recording workspace.
- Start in reduced motion and keep decorative motion still while explicit playback remains usable. Check the static-motion option and offscreen suspension.

DevTools confirms Noto Serif SC Medium for Chinese titles and Noto Sans SC for body copy. The app uses Noto Sans SC with Geist Latin; the presentation uses Inter Latin. No system-font approximation is counted as a verified custom face.

A startup network trace contains no Three.js, video-warp or automatic MP4 requests. Optional `?motion-debug=1` statistics expose render counts and actual RAF intervals for pause/offscreen checks. These measure callback intervals, not GPU/CPU render cost. No fixed frame rate across devices is claimed. Viewport emulation is not physical-phone or cross-browser certification.

## Release and existing workspaces

The source archive is compared byte-for-byte to a fresh Git archive at the release commit, honoring declared line endings. The wheel and source are installed into separate clean environments, packaged application files are checked against the wheel, and the Python suite also runs from installed site-packages.

Compatibility checks open a copy of a populated 0.6 workspace and compare all schemas, tables, active keys, scores, notes and history. Edit/undo runs only on the copy; referenced source audio and the original legacy folder are hashed before and after.

The local upgrade stops the old app server, backs up the entire active and legacy workspaces, installs in the existing app environment and reopens the original path. Private receipts record the installed files and unchanged workspace hashes. No schema migration or training-environment change is introduced.

[0.9 checks](verification-0.9.md) · [Media provenance](showcase-media.md) · [Font build](fonts.md)
