# Release verification

Version 0.12.0 · 2026-10-27

## Local tests

96 Python tests and 90 JavaScript tests pass locally, with no failures or skips. The final Python source run completed in 21.40 seconds; the JavaScript run completed in 0.89 seconds.

Coverage includes decoding, duplicate detection, review persistence, safe import boundaries, bilingual errors, package resources and the current page's local import graph. The artwork checks cover mesh winding and index limits, smoothed depth gradients, interrupted transitions, unsupported graphics and partial GPU allocation cleanup. Playback tests exercise rapid pause/replay, replacement files, stale promises and late callbacks.

## Browser checks

The new artwork initialized WebGL depth relief in Chromium. Scene switching and the Chinese/English controls were checked, including 320px and 390px layouts. Escape closes the menu and returns focus to its button. The three artwork labels were removed from the visible controls; accessible labels remain.

Reduced motion starts the artwork still and permits a single redraw when switching images. A measured 1.813-second paused interval recorded zero WebGL draw calls. Losing the graphics context showed the original image; restoration returned to depth relief. The explicit `graphics=off` option also displayed the image fallback.

The active diagnostic window was throttled to roughly one animation callback per second: two callbacks and four draw calls in 2.207 seconds. This confirms the coverage and relief passes ran, but cannot establish smooth frame pacing. No 60fps or device-wide performance guarantee is made. Viewport emulation also does not replace testing on a physical phone.

A local FLAC was selected and played through the browser object URL. No network requests were recorded during that interval; its file hash was unchanged. The audio was not added to the repository. This is playback verification, not a listening-quality rating.

On a private copy of a populated older workspace, A/B playback, range looping, time notes, save-and-continue and undo were exercised. The saved range and note were read back after returning to the item; undo restored its earlier range and note. Chinese and English labels and the Chinese import-boundary error were inspected.

## Release gate

Package, compatibility and deployment evidence is recorded against the release commit outside the public package. Publication requires:

1. Build source and wheel from a clean commit and compare the archive with that commit.
2. Install source and wheel in separate clean application environments, compare installed bytes and run the Python suite from installed `site-packages`.
3. Open a copy of a populated 0.6 workspace and compare review keys, scores, notes and history. Keep the original workspace and source audio unchanged.
4. Complete the same commit's Windows, Linux, macOS, Python 3.11/3.13 and FFmpeg CI jobs.
5. Compare deployed website files and downloaded GitHub assets with the verified release.
6. Stop the local app, back up the complete active and legacy workspaces, upgrade the existing application environment and reopen its original workspace.

The test counts above describe local tests; the release body records the completed package and CI checks after those gates pass. Application and temporary QA environments are used. Training environments, original recordings and models are kept outside the upgrade.

[Artwork](artwork.md) · [Media](showcase-media.md) · [Fonts](fonts.md) · [Upgrade notes](releases/0.12.0.md)
