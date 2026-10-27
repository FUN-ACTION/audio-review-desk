# Interface notes

## Music and listening

The 0.10 website uses an original moving score as its main illustration. Notes, stems, beams and staves are drawn in Canvas 2D; they are not a video or a downloaded model. A pointer can bend or pluck the score, and a click can produce a short generated tone.

The design uses warm paper, dark ink, one blue accent and aligned text columns. Chinese headings use Noto Serif SC at weight 500. Chinese body text and controls use Noto Sans SC in both the website and listening workspace. Latin text stays Inter on the website and Geist in the workspace. Fonts are bundled locally; see [font maintenance](fonts.md).

## Motion and input

The score advances with elapsed time. Pointer displacement returns through a damped motion model, retaining the place where a note was grabbed. Compact layouts draw fewer notes and cap rendering resolution. The scene stops its animation loop out of view or while the document is hidden.

The motion button has separate pause and resume states. Reduced motion starts the decorative score still; explicit audio playback remains available. Sound begins from a user action. The fallback is the project's own static score illustration.

Header controls stay in one aligned row. Section headings share a left edge, and the recording list uses ordinary play buttons and durations. The menu supports Escape, keyboard focus and interrupted opening or closing.

## Playable examples

The comparison, range and time-marker examples use the project's twelve-second generated piano phrase. The two A/B versions have different harmonic balances and matched RMS levels. SVG waveform peaks come from those signals.

Range boundaries can be dragged or moved with the arrow keys; Home and End reach their allowed limits. Dragging preserves the grab offset, and overlapping hit areas choose the nearest edge. A cancelled gesture restores its previous range. The selected range can be looped.

In the time-marker example, clicking the waveform or pressing Enter adds a marker. Its time seeks within the sample, and the marker can be removed. Switching language or example mode retains the current range and markers. This state belongs to the website example; it does not create collection reviews.

The audio clock drives the example playhead. Structural labels are not rewritten on every frame, and the example has no idle render loop. Ordinary page scrolling remains under the browser's control.

## Recordings

All six application recordings were re-recorded in the 0.10 interface, with separate Chinese and English takes. Each preserves the full 1280 × 720 application viewport. They appear in a separate list and load when opened. The fullscreen viewer retains native playback, seeking and close controls. There is no large title over the footage and no scroll-warp renderer in the new page.

The recordings use the current Noto Sans SC / Geist workspace typography and independent generated-signal workspaces. Saved results were read back after the recorded actions. [Media notes](showcase-media.md) describe their source and capture process.

## Listening workspace

The workspace keeps its library, waveform, review panel, import actions and light/dark appearance. Its Chinese font changes in this release; its review data model does not.

Time notes can be added, edited, moved and removed. Invalid times keep the editor open, and cancelling restores the prior note. Search includes filenames, IDs, review notes and time notes. Save & continue follows the current queue. Listening memory stays separate from review data and resumes paused.

## Earlier references

The [Lusion source study](reference-study.md) records the 0.9 investigation of typography, menu and rendering behaviour. Earlier [Superlist](https://www.superlist.com/) references informed the use of application footage. Version 0.10 replaces the glossy 3D composition with music notation appropriate to this project.

Three.js, the 0.9 scene modules and old font files remain available for older pages, but the new tour does not import the Three bundle or reel-warp module. Reference-site code, models, photographs, films, logos and proprietary fonts are not redistributed.

[Verification](verification.md) records the actual tests, browser checks and package validation for this release.

![Website](screenshot-tour.png)
