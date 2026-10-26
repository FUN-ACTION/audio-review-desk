# Walkthrough media

[Watch the walkthrough](https://fun-action.github.io/audio-review-desk/tour/).

The six MP4 files are recordings of Audio Review Desk running in Chromium. Chinese and English takes were recorded separately. The clips show playback, A/B reference comparison, time notes, saved reviews and boundary dragging. `scripts/create_showcase.py` creates the original test signals in a new, separate workspace. No private recordings or models appear in the media.

The recordings keep the capture timing, including pauses. A cursor is composited from the actual input-coordinate trace. The two close-up videos crop the listening area of the same desktop interface; they do not depict a mobile app. Files are encoded as H.264 at 30 fps with fast-start metadata and no audio track. Capture cadence varies with browser updates; encoding at 30 fps is not a claim of 30 unique captured frames per second.

The desktop scene is an original image generated for this project with the built-in image generation tool on 2026-10-26. The final asset is `src/audio_review_desk/static/tour/media/studio-scene.webp`. It is a backdrop, not a photograph of a user's setup. Browser frames and the laptop surround are CSS. Superlist's photographs, videos, logos and Haffer fonts are not distributed.

## Reference

[Superlist](https://www.superlist.com/) was inspected for its warm-white canvas, type proportions, alternating feature sections and embedded video placement. At the inspected viewport its title used Haffer XH Bold, 68 px, 69.36 px line height and -3 px tracking. Body background was `rgb(255,253,249)`. The four feature videos were muted video elements. These observations describe the page inspected on this date; this project's layout and media are its own.

This project uses the already bundled Inter and Noto fonts, with platform Chinese UI fonts. Font and Motion licences are listed in [third-party notices](../THIRD_PARTY_NOTICES.md).

## Background prompt

Built-in image generation was used with this final prompt:

> Use case: photorealistic-natural. Asset type: wide photographic backdrop for an open-source audio review application's product showcase. Create an original warm, understated home audio editing workspace, photographed straight on at seated eye height with a 50 mm lens, generous horizontal composition, 1920x1200 or wider landscape. A natural pale oak desktop fills the bottom quarter, quiet warm ivory plaster wall at center, soft afternoon window light from the left, delicate real shadows. At the far left edge a leafy plant and part of a small matte charcoal studio speaker. At the far right edge a neatly coiled pair of dark over-ear headphones and a ceramic cup. The middle 70 percent must stay spacious and visually quiet because an actual software recording in a separate computer window will be overlaid there later. No computers, no screens, no phones, no people, no text, no lettering, no logos, no watermarks. Editorial interior photography, tactile wood grain, imperfect natural materials, warm white, sand and soft brown palette. Calm, believable, expensive but lived-in; not a futuristic studio, no neon, no excessive props, no decorative gradients. The backdrop must be visually distinct from any specific existing website photograph.

## Rebuilding

Normal users do not need these steps. The assets are already packaged.

1. Run `python scripts/create_showcase.py /new/recording-destination`. It refuses an existing populated destination.
2. Serve its `workspace` directory with Audio Review Desk. In the Codex browser runtime, pass the tab and its documented CDP capability to `makeRecorder` in `scripts/record_showcase.mjs`. Use visible controls, never inject review state. Record separate language takes.
3. Run `python scripts/encode_showcase.py /capture/capture.json --name workflow-zh --output src/audio_review_desk/static/tour/media`. Use `--crop` for the notes and range close-ups. FFmpeg with libx264, libass and libwebp is required only for encoding.
4. Run `python scripts/build_showcase.py --output /new/static-output` for the standalone site. The builder copies only walkthrough assets, fonts and licences; it never reads a workspace.

The page loads clips as they become visible, pauses out of view and offers manual pause. Reduced motion and data saving keep the poster until a play button is pressed. The app's empty-workspace preview always waits for a click. Asset hashes and capture counts are in [the media manifest](showcase-media.json).
