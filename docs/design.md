# Interface notes

## Reference

The 0.7 walkthrough follows [Superlist](https://www.superlist.com/) for type proportions, warm-white space, alternating feature sections and direct application footage. The live page was inspected in five viewport widths. At 1280 px, its heading used Haffer XH Bold at 68 px / 69.36 px, with a 700 px measure; the application image was 1120 px wide. Body text used Inter. These observations describe the inspected page, not a claim about an earlier award-winning build.

Audio Review Desk uses its own recordings and open fonts. Haffer, Superlist photographs, brand assets and site code are not included. The earlier photo surround has been removed. Recordings show the actual desktop interface, including real input and save results.

## Type and layout

- Manrope is used for Latin display headings; Inter is used for Latin interface and body text.
- Noto Sans SC handles Chinese before platform fallbacks. Chinese headings use weight 500. A small interface subset loads first; the larger common-character subset remains available for filenames and notes.
- The tour uses a warm-white background, 1120 px maximum content width and two feature columns. Large headings and body copy use separate measures. Chinese and English have separate size and line-break adjustments.
- The app keeps its toolbar, library, listening area and inspector. Optional issue tags are in a disclosure; decision, note and save stay easy to reach. On small screens, appearance, language and help share a compact settings panel.
- Source selection is a short set of actions above a direct video preview. A filtered library never turns into the empty-workspace introduction.

## Motion

The app bundles [Motion 14.6.0](../THIRD_PARTY_NOTICES.md). Springs move the A/B indicator and selected library highlight from their current positions, retaining velocity when interrupted. Dialogs enter in 220 ms and leave in 140 ms; menus use a shorter transition. Keyboard actions and reduced-motion preferences bypass decorative transitions.

Repeated clip selection does not fade the player or rebuild unchanged library rows. Audio time drives the playhead. Seeking and boundary dragging track input directly, without an easing delay. Waveform drawing is separate from playback movement.

The tour plays one visible film at a time and stops after one pass. Replay, seeking and a larger viewer are available. A larger viewer pauses inline footage and returns focus when closed. Reduced motion and data saving prevent automatic playback; manual play remains available. The app's preview always waits for a click.

## Review behaviour

Time notes can be added, edited, moved and removed. Invalid times keep the editor open. Cancelling an edit restores the original note and clears a false dirty state. Save includes any note being composed.

Search combines saved filenames, IDs, review notes and time notes. A clip outside the current filter keeps its draft and displays a route back to the full library. Continue follows the existing queue and skips reviewed clips, including when the saved row leaves a pending filter.

Listening memory is separate from review data. It is scoped to the workspace and versioned audio key, keeps at most 64 recent positions, and always resumes paused. Turning it off clears positions. Browser storage failures leave the reviewer usable.

## Maintenance

Font sources, licences and digests are in [third-party notices](../THIRD_PARTY_NOTICES.md). [Media notes](showcase-media.md) describe the procedural signals, capture input, crop regions and encoding. [Verification](verification.md) distinguishes automated checks, browser inspection and package checks.

![Workspace](screenshot-zh-CN.png)

![Walkthrough](screenshot-tour.png)
