# Website media

[Open the website](https://fun-action.github.io/audio-review-desk/tour/).

## Score and audio examples

The 0.10 presentation draws its own notes, beams and curved staves in Canvas 2D. The score responds to pointer movement and plucking. Its static fallback is an original SVG score illustration. Neither requires a model, a texture or footage from another website.

The short pluck tones are synthesized after a click. `studio-signal.js` generates the twelve-second piano phrase and its two A/B versions. The SVG examples use waveform peaks from those actual signals, and their playheads follow the audio clock. Selected ranges and time markers remain in the example page, separate from collection reviews.

The new tour does not import Three.js or the old video-warp renderer. Motion can pause, and offscreen/hidden components stop rendering. No artist recording, private material or trained voice is used for the score or sample phrase.

## Application recordings in 0.10

All six MP4 files were newly recorded from the Audio Review Desk 0.10 source interface in Chromium. Chinese and English takes used independent generated-signal workspaces. The recordings show the current Noto Sans SC / Geist workspace typography and preserve the full 1280 × 720 application viewport, without a close-up crop.

| Recording | Captured actions |
| --- | --- |
| Workflow | Switch A/B, mark a clip as needing work, add a review note, then Save & continue |
| Time notes | Add a timestamped note and save the review |
| Keep range | Move a range handle, loop the selected interval and save the review |

The actions were performed through native browser input, and the saved results were read back after recording. The files appear in a simple list and open in the fullscreen viewer with playback and seeking controls. They do not depict a separate mobile application.

## Recording source

`scripts/create_showcase.py` creates deterministic procedural signals in a new, separate directory. Phrase envelopes, pitches and pauses vary. The signals contain no speech, private recording or model output. Scores and notes in the footage illustrate the controls. The generator refuses to overwrite a populated destination.

No private audio, databases or model weights are distributed.

## Capture and encoding

Browser input operates visible controls. A cursor is composited from the recorded input coordinates. Capture timestamps set the timing; the encoder resamples them to 30 fps and retains the final still frame until capture ends. This does not imply 30 unique browser captures per second. Files use H.264, yuv420p, fast-start metadata and no audio track.

The wheel and standalone website include the same recordings and posters. Hashes, durations, dimensions and capture counts are in [the recording manifest](showcase-media.json).

## Rebuilding

The score and SVG examples are drawn from source, so they need no video encoding step. Ordinary users do not need the media tools.

To record new application footage:

1. Run `python scripts/create_showcase.py /new/recording-destination` and serve that workspace.
2. In the Codex browser runtime, pass the tab and documented CDP capability to `makeRecorder` in `scripts/record_showcase.mjs`. Record separate language takes and check the saved review before selecting a take.
3. Run `python scripts/encode_showcase.py /capture/capture.json --name workflow-zh --output src/audio_review_desk/static/tour/media`. Use `--name notes-zh` or `--name range-zh` for the other workflows, and the matching `-en` names for English takes. Keep the full frame; `--poster-at` chooses a representative poster. Encoding needs FFmpeg with libx264, libass and libwebp.
4. Update the recording manifest, then run `python scripts/update_showcase_index.py` to refresh its duration index.
5. Build the static website with `python scripts/build_showcase.py --output /new/static-output`.

The static builder copies page code, media, fonts and licences without opening a workspace.

## Earlier presentation assets

The earlier cropped 0.8 recordings are documented in [the 0.8 media notes](https://github.com/FUN-ACTION/audio-review-desk/blob/v0.8.0/docs/showcase-media.md).

The Three.js bundle, 0.9 scene and reel modules, and their original poster remain packaged for older pages. They are not loaded by the 0.10 entry point. Their build lock and digest remain in `scripts/scene-build`.

The [0.9 interaction capture](https://github.com/FUN-ACTION/audio-review-desk/blob/v0.9.0/docs/site-interaction.gif) records that version's dragging and palette changes. The generated desk backdrop used in 0.6 is no longer included; its provenance remains in [the 0.6 media notes](https://github.com/FUN-ACTION/audio-review-desk/blob/v0.6.0/docs/showcase-media.md).

[Lusion](https://lusion.co/) informed the 0.9 reference study. Its code and media are not bundled. [Third-party notices](../THIRD_PARTY_NOTICES.md) cover the separately licensed fonts and libraries.
