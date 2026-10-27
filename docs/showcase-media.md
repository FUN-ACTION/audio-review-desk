# Walkthrough media

[Watch the walkthrough](https://fun-action.github.io/audio-review-desk/tour/).

The six MP4 files record the development UI for Audio Review Desk 0.8 running in Chromium. Chinese and English takes were recorded separately. The main film shows playback, reference switching and Save & continue. Close-ups show adding and seeking to a time note and looping a selected range.

## Source material

`scripts/create_showcase.py` creates deterministic procedural signals in a new, separate directory. They have varied phrase envelopes, pitches and pauses. They contain no speech, recordings or model output. Scores and notes in documentation illustrate controls, not an evaluation of a real recording. The generator refuses to overwrite a populated destination.

The videos contain no private audio, databases or model weights. A desktop crop remains a crop of the desktop app; it does not depict a mobile app.

## Recording and encoding

Browser input operates visible controls. A cursor is composited from the recorded input coordinates. Capture timestamps set the timing; the encoder resamples them to 30 fps and retains the final still frame until the capture ends. Encoding at 30 fps does not imply 30 unique browser captures per second. The videos are H.264, yuv420p, with fast-start metadata and no audio track.

| Clip | Source viewport | Crop x, y, width, height |
| --- | --- | --- |
| Workflow | 1280 × 720 | 282, 136, 964, 576 |
| Time notes | 1280 × 720 | 300, 180, 650, 460 |
| Keep range | 1280 × 720 | 300, 240, 650, 420 |

The files and posters are bundled in the wheel and standalone site. The interface loads a film on request, pauses it out of view and offers replay, seeking and a larger viewer. Reduced motion and data saving keep the poster until manual play. The app preview always waits for a click.

## Rebuilding

Ordinary users do not need to rebuild media.

1. Run `python scripts/create_showcase.py /new/recording-destination` and serve its `workspace` directory.
2. In the Codex browser runtime, pass the tab and documented CDP capability to `makeRecorder` in `scripts/record_showcase.mjs`. Use visible controls and separate language takes. Review the resulting save state before choosing a take.
3. Run `python scripts/encode_showcase.py /capture/capture.json --name workflow-zh --output src/audio_review_desk/static/tour/media`. For a note close-up, add `--region 284 180 600 480`; for range editing, use `--region 284 70 600 600`. `--poster-at` selects a representative frame. FFmpeg with libx264, libass and libwebp is required for encoding.
4. Run `python scripts/update_showcase_index.py` after updating the media manifest. This gives the player a duration without downloading the video.
5. Run `python scripts/build_showcase.py --output /new/static-output`. The builder copies page code, bundled media, fonts and licences. It does not open a workspace.

Asset hashes, capture counts, dimensions and durations are in [the manifest](showcase-media.json).

## Visual reference

[Superlist](https://www.superlist.com/) informed the product demonstrations and type hierarchy. [Lusion](https://lusion.co/) informed the pale background, asymmetric heading and spacious composition. This version uses direct application footage and open fonts. Reference-site photographs, videos, logos and Haffer fonts are not distributed. See [font and Motion licences](../THIRD_PARTY_NOTICES.md).

The generated desk backdrop used in 0.6 is no longer included. Its provenance remains in the [0.6 media notes](https://github.com/FUN-ACTION/audio-review-desk/blob/v0.6.0/docs/showcase-media.md).

The recordings were captured from the new source UI before the release version was stamped. The six files replace the 0.7 recordings.

## Interactive sample

The homepage sample is separate from the recordings. `studio-signal.js` generates a twelve-second piano phrase with two timbral variants, matched to the same RMS level. The browser draws peaks from those buffers and plays them through Web Audio after a click. Range handles, A/B, loop and the note field are interactive. Nothing is saved as a real review. No audio API or upload endpoint is called.

The short silent introduction plays once while visible. It can be paused or replayed. Reduced-motion and data-saving preferences suppress the introduction; explicit controls remain available. The waveform is redrawn when its content, selection or size changes; the playhead uses a transform.
