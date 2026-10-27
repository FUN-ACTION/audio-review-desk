# Release verification

Version 0.9.0 · 2026-10-27

## Automated checks

88 Python tests and 44 JavaScript tests pass locally. The added cases check the deterministic scene simulation, bounded dragging and impulses, timestep stability, collision separation, finite coordinates and rejected invalid inputs. Server and build tests cover the new scene modules, renderer bundle, poster, complete Three.js licence, MIME types and strict file boundaries.

The pinned Three.js version, lockfile, runtime size and SHA-256 are checked without downloading dependencies in CI. Existing tests cover audio decoding, read-only inputs, review versions, history, conflicts, cancellation, export/restore, sample audio, bilingual copy, packaged fonts and all six retained recording/poster hashes.

Tests use temporary workspaces and generated signals. CI runs Python 3.11 and 3.13 on Windows, Linux and macOS, plus an FFmpeg job. The release links the CI result for its exact commit.

## Browser inspection

The presentation was exercised in local Chromium:

- Push and drag the actual 3D objects, change their palette and pause the scene. Inspect the captured result rather than a simulated cursor illustration.
- Open, close and reverse the card menu; check Escape, backward Tab wrapping, focus return and section-link focus.
- Play the generated sample from a click; stop it when its scene leaves view.
- Scroll the recording surface from its small tinted state to the full frame. Pause the inline preview and open the full player. Check actual decoded video and native controls.
- Open the English time-note recording after changing language; keep the matching source and viewer title.
- Start with reduced motion: scene motion stays paused, the preview stays still and the warp is bypassed. Explicit video playback remains available.
- Load `?graphics=off`: use the project's static scene poster and ordinary video without constructing the two WebGL surfaces.
- Measure Chinese and English layouts at 320, 390, 768, 1024 and 1440 CSS pixels. Fix the narrow English download overflow and the desktop header/intro collision; inspect narrow and wide rendered views.

Tour Latin text uses Inter Regular; Chinese uses the unchanged MiSans Regular file. The review workspace keeps Geist / MiSans. Viewport emulation is not physical-phone or cross-browser certification. Context-loss recovery was reviewed in code; it was not fault-injected on every GPU. No constant frame rate is claimed across devices.

The new [interaction capture](site-interaction.gif) shows real pointer input on the 0.9 page. The six application recordings retain their 0.8 bytes; they are not presented as new recordings.

## Packaging and existing workspaces

Release archives are built from a clean committed tree. The wheel and source package are installed in separate environments, and packaged bytes are compared against the wheel. The Python suite also runs with application imports proven to come from the installed wheel.

Compatibility verification opens a copy of a populated 0.6 workspace, compares its schema, tables, active keys, scores, notes and history, then exercises edit/undo on that copy. Referenced original inputs are hashed before and after. No workspace migration is introduced in 0.9.

The local upgrade stops the old app server, backs up the entire workspace, installs in the existing application virtual environment and reopens the original path. Private receipts record backup hashes, installed bytes and the unchanged legacy database. Original recordings, models and training environments remain outside the release.

[0.8.1 checks](verification-0.8.1.md) · [Media provenance](showcase-media.md) · [Source study](reference-study.md) · [Font maintenance](fonts.md)
