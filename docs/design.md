# Interface notes

## Reference

For 0.8, the live Superlist and Lusion pages were inspected again. Superlist's current hero used Haffer XH SemiBold at 64/60.8 px, weight 600, with Inter body text. Lusion used Aeonik and a pale, spacious layout around a wide visual. These are observations of the pages available on 2026-10-27, rather than specifications copied from an earlier build.

The new layout uses an asymmetric title, a pale lavender background and a large interactive audio card. It uses original code, generated signals and the application's own recordings. Reference photographs, videos, proprietary fonts and website source are not distributed.

## Type and layout

Geist carries Latin text and numbers; the official MiSans Regular handles Chinese. Chinese text stays at its supplied weight. Font synthesis is disabled. Files are bundled for offline use; see [the font guide](fonts.md) for pinned inputs and the unchanged MiSans file.

The workspace has a white library and listening card on a pale background. The review form uses a quieter surface, keeping the decision and save actions separate from the waveform. A narrow viewport collapses the library and moves the review form below playback. Empty workspaces show direct import actions, with a link to the tour.

The tour has a playable sample followed by one recording area with three tabs. It avoids repeating platform badges, explanatory footers and long feature captions around every player.

## Motion

The app bundles [Motion 14.6.0](../THIRD_PARTY_NOTICES.md). Springs move the A/B indicator and selected library highlight from their current positions, retaining velocity when interrupted. Dialogs enter in 220 ms and leave in 140 ms; menus use a shorter transition. Keyboard actions and reduced-motion preferences bypass decorative transitions.

Repeated clip selection does not fade the player or rebuild unchanged library rows. Audio time drives the playhead. Seeking and boundary dragging track input directly, without an easing delay. Waveform drawing is separate from playback movement.

The tour starts recordings on request, plays one visible film at a time and stops after one pass. Replay, seeking and a larger viewer are available. A larger viewer pauses inline footage and returns focus when closed. Reduced motion and data saving prevent automatic playback; manual play remains available. The app's preview always waits for a click. The interactive sample has a short silent introduction with pause and replay; audio requires a separate click. Reduced motion and data saving suppress the introduction. Offscreen playback pauses. Normal sample playback updates the clock and transformed playhead without redrawing its unchanged waveform.

## Review behaviour

Time notes can be added, edited, moved and removed. Invalid times keep the editor open. Cancelling an edit restores the original note and clears a false dirty state. Save includes any note being composed.

Search combines saved filenames, IDs, review notes and time notes. A clip outside the current filter keeps its draft and displays a route back to the full library. Continue follows the existing queue and skips reviewed clips, including when the saved row leaves a pending filter.

Listening memory is separate from review data. It is scoped to the workspace and versioned audio key, keeps at most 64 recent positions, and always resumes paused. Turning it off clears positions. Browser storage failures leave the reviewer usable.

## Maintenance

Font sources, licences and digests are in [third-party notices](../THIRD_PARTY_NOTICES.md). [Media notes](showcase-media.md) describe the procedural signals, capture input, crop regions and encoding. [Verification](verification.md) distinguishes automated checks, browser inspection and package checks.

![Workspace](screenshot-zh-CN.png)

![Walkthrough](screenshot-tour.png)
