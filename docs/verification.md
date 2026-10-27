# Release verification

Version 0.11.1 · 2026-10-27

## Local tests

96 Python tests and 73 JavaScript tests pass locally, with no failures or skips. The Python run completed in 19.32 seconds; the JavaScript run completed in 0.89 seconds.

Coverage includes audio decoding, duplicate detection, review persistence, range and marker editing, safe import boundaries, bilingual error messages and static assets. Graphics checks cover closed note and ribbon geometry, finite unit normals, triangle winding, index limits and unavailable-context fallbacks. Eleven injected allocation failures check that partially created GPU resources are released and the renderer returns its fallback. The import-graph check follows the current page's local modules and rejects video or software-demo dependencies in that entry graph. Pinned graphics, motion and font resources are checked against their build records.

The 0.11.1 follow-up checks system motion-preference changes and explicit playback across the hero and artwork.

## Browser checks

The current Chinese and English page was inspected in Chromium at 320, 390, 768 and 1280 CSS pixels. Font inspection confirmed that the supplied MiSans face renders Chinese copy. Opening the menu stops sample audio. Escape closes it and returns focus to the menu button. The three material canvases initialized WebGL; the musical-note hero uses its separate 3D scene.

The checked artwork context switched to its SVG fallback when the graphics context was lost and returned to WebGL after restoration. The `graphics=off` option keeps the fallback available. Reduced motion and the pause control stop continuous animation; leaving the viewport or hiding the page suspends rendering.

The unchanged 0.11.0 visual baseline recorded 180 `requestAnimationFrame` callback intervals each:

| Scene | Mean | Median | 95th percentile | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Musical-note hero | 6.09 ms | 6.10 ms | 6.20 ms | 12.10 ms |
| Material artwork | 6.06 ms | 6.10 ms | 6.20 ms | 6.20 ms |

These are callback intervals observed on this machine, not GPU render times or a guaranteed frame rate. Viewport emulation also does not substitute for testing a physical phone or another browser.

During a separate 48.04-second paused sample of that baseline, Chromium's cumulative `ScriptDuration` and `LayoutDuration` did not increase. `LayoutCount` remained at 12. Style recalculation increased by 0.52 ms and is recorded separately. This sample checks idle behavior while paused; it does not measure power consumption.

## Release gate

Package, compatibility and deployment results are recorded against the final release commit. The release checks must:

1. Build source and wheel from a clean commit, then compare the source archive to a fresh Git archive.
2. Install source and wheel into separate clean application environments, compare installed package bytes with the wheel, and run the Python suite from installed `site-packages`.
3. Open a copy of a populated older workspace and compare schemas, review keys, scores, notes and history. Edit and undo only on that copy; hash the original workspace and referenced audio before and after.
4. Complete CI for that same commit: Windows, Linux and macOS on Python 3.11 and 3.13, plus the FFmpeg job.
5. Compare every deployed showcase resource with the verified wheel, and read back the release assets and checksums from GitHub.
6. Stop the local app, back up the entire active and legacy workspaces, upgrade in the existing application environment, and reopen the original workspace path. Verify installed bytes and unchanged database rows after startup.

Those steps are the publication workflow, not additional completed results claimed by the local test counts above. The workflow uses application and temporary QA environments; it does not install into a training environment or alter source recordings and models.

[0.9 checks](verification-0.9.md) · [Media provenance](showcase-media.md) · [Fonts](fonts.md) · [0.11 upgrade notes](releases/0.11.1.md)
