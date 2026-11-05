# Interface notes

These notes describe the current source tree. The acoustic presentation and workspace layout were introduced in [0.13.0](releases/0.13.0.md); subsequent [maintenance changes](verification-2026-11-maintenance.md) are unreleased.

## Composition and type

The unreleased tour redesign uses warm ivory, charcoal and copper. An asymmetric opening pairs large, two-line typography with a compact introduction. A dark listening room integrates the sound sculpture and real playback controls. A single tabbed review desk replaces the three separate demonstration cards; numbered editorial sections carry the same spacing, rules and typographic hierarchy through the rest of the page. Functional text remains at least 12 pixels, with larger body copy; smaller catalog labels are decorative. Buttons and links use inline SVG rather than platform-dependent symbol glyphs. The listening workspace uses a light-gray library, dark audio canvas and separate review panel, with a dark theme available.

The tour uses bundled Inter through the `Review Studio` family, followed by platform fonts and bundled MiSans for supported Chinese characters. The workspace uses bundled Geist and MiSans, with font synthesis disabled. [Font notes](fonts.md) describe the files and fallback order.

## Acoustic scene

[signal-stage.js](../src/audio_review_desk/static/tour/signal-stage.js) builds 44 rings using shared torus geometry, a perspective camera and warm metallic lighting and thicker copper-colored surfaces. Pointer movement changes the viewpoint slightly; audio level gently changes the form. The listening button starts a generated phrase, or the user can select a local song. Playback requires an explicit action, and selected files stay in the browser.

Continuous rendering stops when paused, offscreen or in a hidden document. Reduced motion starts the scene still. A CSS acoustic form remains visible if WebGL cannot initialize or its context is lost. These are implementation behaviors, not claims of measured frame rate or visual acceptance.

The motion control is disabled and identifies the static artwork when the renderer is unavailable. Context restoration returns to the user's previous motion choice. Time sliders announce localized seconds. Pending playback keeps the latest seek, version, interval or loop choice; changing panels and an explicit second Play/Pause click cancel it. Selecting the already active tab does not interrupt playback.

## Browser listening desk

[tour.js](../src/audio_review_desk/static/tour/tour.js) connects three examples to an original twelve-second phrase from [studio-signal.js](../src/audio_review_desk/static/tour/studio-signal.js): compare two timbres at the same time position, loop a selected interval, and add, select or delete timestamped notes. Example notes are temporary and do not write workspace reviews. [review-tabs.js](../src/audio_review_desk/static/tour/review-tabs.js) progressively adds three accessible tabs. Switching stops pending or active audio without destroying panel state. Arrow keys, Home and End activate local panels; composition events are ignored. Without script all three sections remain readable. The notes panel can export up to 20 timed notes as a local JSON file, explicitly identified as notes for the synthesized sample. Export does not save to the full workspace. The current page contains no embedded video or operation recording.

The unpublished candidate also lets the user select one real local audio file. [local-review.js](../src/audio_review_desk/static/tour/local-review.js) uses a browser media element and object URL, without uploading the file or decoding its full PCM into JavaScript. The same selected file reaches the top player and the listening, range and note panels. Local B is explicitly unavailable; restoring the sample restores synthetic A/B. The cursor follows the local file between panels.

The supported browser-preview scope is a nonempty file up to 64 MiB, with a finite duration from 0.05 seconds through one hour, in a format supported by the browser. Metadata loading has a twelve-second deadline and can be cancelled. A failed or cancelled replacement retains the previous source, range and notes. Newer requests invalidate old callbacks, including delayed loop resumes. Playback always needs an explicit action.

Local mode displays an honest time ruler, not the sample waveform. Its range control uses native media seeking, so it is approximate audition, not sample-accurate editing. Real waveform/spectrum analysis and two-file A/B belong to the full local workspace. This page does not import files into that workspace or save reviews there.

Local range and notes can be exported even when there are no notes. The distinct JSON format includes only the basename, duration, selected range and deliberate notes, not audio bytes, paths or incidental file metadata. Pending notes, unfinished text and unexported range edits are protected when replacing or resetting a source. Leaving the page with unexported local changes requests the browser's normal warning. Export errors retain the data and explain recovery; initiating a download does not prove the user saved it. Everything remains session-only and is cleared by a reload.

## Verification boundary

The editorial redesign is a source candidate, not a published release. Automated logic, accessibility-contract, translation and packaging checks do not establish visual acceptance. New 320/390/768/1440-pixel browser screenshots and repeated/interrupted interaction checks remain required in a permitted browser environment. Existing public-site screenshots show the earlier design and must not be represented as the redesigned page.

## Workspace

[workbench-studio.css](../src/audio_review_desk/static/workbench-studio.css) supplies the current workspace layout and colors. The waveform and on-demand spectrogram share playback and range controls. Boundary audition, silence suggestions and quick notes support review before saving. Import, review history and keyboard behavior are covered by the [unreleased maintenance verification](verification-2026-11-maintenance.md).

Normal draft protection stays beside the review state as a compact native disclosure, rather than inserting a full card before the listening area. The expanded disclosure explains its session-only scope and provides Clear; pending recovery and storage failures retain a separate, visible action panel. It does not replace the unsaved/saved distinction. This layout has source-level checks, but not new browser visual acceptance.

Search results explain annotation matches only when the filename or ID does not already explain the query. A quiet two-line excerpt sits below the existing name and metadata, with the saved note source and exact timestamp where applicable. The excerpt starts at a matching grapheme and is capped at 100 Unicode codepoints; it is plain text inside the existing selection button. Default rows stay compact. Contextual rows and their intrinsic placeholder share a 100-pixel height, while compact studio rows share a 66-pixel height. These are source and DOM-model checks, not browser layout acceptance.

Original audio is read-only. Intervals, notes and decisions remain in the separate workspace; a tour example never changes those records.

## Historical presentation

The lavender composition, draggable note geometry, note poster and three musical studies belong to [0.11](releases/0.11.0.md). The generated depth-relief artwork belongs to [0.12](releases/0.12.0.md). Retained artwork, recordings and demonstration modules are outside the current tour's import graph. The [reference study](reference-study.md) records the earlier Lusion investigation.

[Artwork](artwork.md) · [Media](showcase-media.md) · [0.13.0 release verification](verification.md) · [Unreleased maintenance verification](verification-2026-11-maintenance.md)

### Saved-copy confirmation

The local preview distinguishes initiating a JSON download from confirming that it was saved. Discard protection remains until the user explicitly confirms the downloaded snapshot; subsequent edits remain protected. Loading feedback remains visible while exporting an earlier source. A failure in the optional hero player must not disable the independent listening desk. Local transport times show centiseconds so sub-second files remain understandable. These changes have controlled runtime coverage; native browser behavior and visual layout still need acceptance.


### Typed interval times

The range panel accepts a pair of times as seconds or `m:ss`, with up to three decimal places. The Apply action validates the whole pair before changing the playback plan; an invalid request is never silently clamped. The minimum passage is 0.25 seconds, or the whole file for shorter audio. Native audition remains approximate, not sample-accurate trimming.

Typed drafts are distinct from the applied range. Playback-frame paints, translation, tab switching and failed/cancelled file replacement leave drafts intact. Sliders are disabled while a draft needs Apply or Restore. Escape restores the applied values without changing playback. Invalid fields have associated labels, format help and localized live feedback. Both pending and active playback retain only the latest valid Apply request.

Export contains the applied range, never incomplete time text. Unapplied time drafts retain discard protection even after the user confirms an earlier export, including in the synthetic sample. Matching displayed endpoints preserve their exact stored values so ordinary reapplication cannot change non-millisecond media boundaries. The explicit form, help and narrow layout still require native keyboard, screen-reader and visual acceptance.


### Functional contrast

A source-color audit found that the small saved-copy confirmation used decorative copper at 4.084:1 on its declared source-control background. It now uses the existing functional accent at 6.531:1. Note and typed-time field boundaries use a dedicated neutral at 3.581:1 against the light workbench, replacing a 1.615:1 boundary. Decorative copper and separator rules are unchanged.

The narrow regression checks use the declared CSS pairs and the relative-luminance calculation described by W3C's [text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). They do not establish the complete browser cascade, actual rendered clarity, forced-colors behavior, or overall accessibility compliance. Real-browser review remains required.


### Workspace identity resource limit

The optional workspace identity probe remains restricted to the page's existing localhost or 127.0.0.1 origin and `/api/version`; public pages never probe the visitor's machine. The response reader now enforces a 4096-byte limit on actual body data, regardless of Content-Length. Rejected, oversized, timed-out and late responses are cancelled, the request is aborted and reader locks are released. Unsupported body-stream environments keep the download fallback. The 1.5-second deadline covers both request and body reading.

This pass reviewed app-owned JavaScript paths and found no audio/notes upload or persistent-storage path. The language preference is the only stored tour preference. Controlled repeated-operation checks exercised media URL cleanup and response-reader cleanup; they do not prove native browser memory usage, decoder behavior or native media subresource/network behavior. Those remain part of permitted browser acceptance.
