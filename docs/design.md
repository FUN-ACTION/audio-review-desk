# Interface notes

## Composition and type

Version 0.11 restores the 0.9 composition: a lavender background, dark pill controls, a large opening scene, offset headings and two feature columns. The tour uses Inter for Latin text; the listening workspace uses Geist. Both use the unchanged MiSans Regular file for Chinese headings, body text and controls. Fonts are served locally, with synthetic styles disabled.

## Musical scene

`note-geometry.js` builds quarter notes, eighth notes, beamed pairs and a clef from original curves. The note bodies are rounded volume meshes; the clef is a continuous ribbon. The pinned Three.js renderer lights opaque ivory, charcoal and cobalt surfaces. There is no glass or transmission pass.

The bodies move within bounds. Camera framing and placement adapt to the available space, and face tilt is limited to keep the symbols readable. Dragging retains the offset from the point that was grabbed. A click changes the palette; the listening button plays a twelve-second generated piano phrase. It does not start automatically.

Continuous rendering stops when the scene is paused, offscreen or in a hidden document. Reduced motion starts with still geometry. `music-notes-poster.svg` is the static fallback when graphics are unavailable or disabled.

## Music studies

Three compositions below the opening scene explore curved ribbons, flowing forms and a closed harmonic loop. `music-art.js` manages their motion and SVG fallbacks; `music-shader.js` generates the meshes and renders their materials in WebGL 2. They follow elapsed time and pointer position, with pause, reduced-motion and visibility handling.

These are musical artwork. The current tour contains no software-operation illustrations or video players. Earlier application recordings and demonstration modules remain packaged as historical assets, outside the tour's import graph.

## Workspace

The library, waveform, review panel, import flow and review keys keep their existing behavior. Original audio is read-only; intervals, notes and decisions remain in the separate workspace.

The [reference study](reference-study.md) records the earlier Lusion investigation. [Font notes](fonts.md) and [media notes](showcase-media.md) describe the shipped assets; [verification](verification.md) records release checks.
