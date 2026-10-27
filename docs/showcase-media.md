# Website media

[Open the website](https://fun-action.github.io/audio-review-desk/tour/).

## Retained application recordings

The six MP4 files were recorded from the development UI for Audio Review Desk 0.8 in Chromium. Chinese and English takes were recorded separately. The main film shows playback, reference switching and Save & continue. Close-ups show adding and seeking to a time note and looping a selected range.

Version 0.9 changes their presentation, not the recording files. It does not claim these films were recorded again. They appear as the main reel and two feature previews, and can still be opened in the fullscreen player with playback controls.

## Source material

scripts/create_showcase.py creates deterministic procedural signals in a new, separate directory. Their phrase envelopes, pitches and pauses vary. They contain no speech, private recording or model output. Scores and notes illustrate the controls rather than an evaluation of a real recording. The generator refuses to overwrite a populated destination.

No private audio, databases or model weights are distributed. A close-up remains a crop of the desktop app; it does not depict a mobile app.

## Recording and encoding

Browser input operates visible controls. A cursor is composited from the recorded input coordinates. Capture timestamps set the timing; the encoder resamples them to 30 fps and retains the final still frame until capture ends. This does not imply 30 unique browser captures per second. Files use H.264, yuv420p, fast-start metadata and no audio track.

| Clip | Source viewport | Crop x, y, width, height |
| --- | --- | --- |
| Workflow | 1280 × 720 | 282, 136, 964, 576 |
| Time notes | 1280 × 720 | 300, 180, 650, 460 |
| Keep range | 1280 × 720 | 300, 240, 650, 420 |

The wheel and standalone site include the same files and posters. The main preview loops muted while visible; feature previews respond to hover, focus or coarse-pointer visibility. Opening a recording uses the fullscreen player. Out-of-view media pauses, and reduced-motion/data-saving preferences keep previews still until explicit play.

## Original scene and reel surface

The 0.9 hero is rendered in real time with the locally bundled Three.js. Its hollow connector geometry is generated from capped tubes and bores. Studio lighting and three material groups create the scene. Pointer repulsion, dragging and palette-change impulses run in the project's own small simulation.

The static scene poster is made from this project's scene and is used when WebGL is unavailable. It is not a Lusion image or model.

The desktop reel uses an original 32 × 32 video plane shader. Scroll progress changes its rectangle, adds a transient curl and changes the cobalt tint to the recording's original color. Compact and reduced-motion layouts use the ordinary video surface. The shader changes the display of the video; it does not alter the MP4 file.

## Audio sample

studio-signal.js generates the twelve-second piano phrase used by the hero's sample button. Web Audio starts it only after a click. Its level also drives a small visual response in the scene. This sample is separate from the recordings and the review workspace; it does not upload source files or save an approval.

## Rebuilding

Ordinary users do not need to rebuild website media.

1. Run python scripts/create_showcase.py /new/recording-destination and serve its workspace directory.
2. In the Codex browser runtime, pass the tab and documented CDP capability to makeRecorder in scripts/record_showcase.mjs. Use visible controls and separate language takes. Check the save result before selecting a take.
3. For the workflow, run python scripts/encode_showcase.py /capture/capture.json --name workflow-zh --region 282 136 964 576 --output src/audio_review_desk/static/tour/media. Use --region 300 180 650 460 for time notes, or --region 300 240 650 420 for range editing. --poster-at selects a representative frame. Encoding needs FFmpeg with libx264, libass and libwebp.
4. Update the media manifest, then run python scripts/update_showcase_index.py to keep its accompanying duration index consistent.
5. Rebuild the pinned Three bundle with npm ci --prefix scripts/scene-build and node scripts/scene-build/build.mjs. No reference-site models or textures are fetched by this step.
6. Run python scripts/build_showcase.py --output /new/static-output. The builder copies page code, media, fonts and licences without opening a workspace.

File hashes, capture counts, dimensions and durations are in [the media manifest](showcase-media.json). The [third-party notices](../THIRD_PARTY_NOTICES.md) cover Three.js, Motion and fonts.

## Reference

[Lusion](https://lusion.co/) informed the real-time hero, large type, scroll composition, navigation cards and reel transition. Geometry, simulation, shaders and controllers were implemented for Audio Review Desk. Lusion's source, photographs, videos, models, logos and proprietary fonts are not bundled.

The generated desk backdrop used in 0.6 is no longer included. Its provenance remains in [the 0.6 media notes](https://github.com/FUN-ACTION/audio-review-desk/blob/v0.6.0/docs/showcase-media.md).

## 0.9 interaction capture

[site-interaction.gif](site-interaction.gif) is a new recording of the 0.9 presentation page, showing actual dragging and palette changes. It was captured through browser input and encoded at 720 pixels wide and 9 fps for the repository. It is a preview of the live interaction, separate from the six application recordings above. The fallback poster is a crop of this project's own rendered scene.
