# Website media

The [project website](https://fun-action.github.io/audio-review-desk/tour/) renders generated images as shallow depth reliefs. The application workspace has no embedded video.

## Current artwork

`art-stage.js` loads these files from `src/audio_review_desk/static/tour/media/`:

| File | Artwork |
| --- | --- |
| `art-bloom.png` | A dark glass form opening like a flower or sound wave |
| `art-wave.png` | Pale acoustic sheets against a warm white background |
| `art-prism.png` | A violet optical prism with refracted light |

The PNGs were newly generated for this project with the built-in ImageGen tool. [Artwork provenance](artwork.md) records their source and use.

The native WebGL renderer places an image on a fine mesh and uses a smoothed, slope-limited depth map to move its vertices. Perspective and limited drag rotation add a small change of viewpoint while keeping the original RGB texture. This single-image relief is not a complete 3D model. Devices without the required vertex-texture support use flat flow-field motion; without WebGL, the original image remains visible.

Motion can pause. Reduced-motion preferences start the artwork still, and continuous rendering stops outside the viewport or in a hidden tab. During playback, the audio level gently changes the motion.

The tour uses locally bundled Inter for Latin text and MiSans for Chinese. The workspace keeps its compact listening and review columns; visual changes do not change the review-data format.

## Audio

`studio-signal.js` generates the default twelve-second piano-like phrase. Playback begins only after the user presses Play.

A selected local audio file is opened by `music-player.js` through a browser object URL. The file is not uploaded or added to the release. Replacing or resetting it releases the previous object URL. The selected recording supplies an amplitude envelope for the animation; it is not transcribed into a score.

No supplied PDF, local song, private recording, database or model weight is included in the artwork assets.

## Historical recordings

Six MP4 files from the 0.10 interface remain in the media directory for older pages and provenance. They cover workflow, time notes and keep ranges in Chinese and English, using generated test signals. The active tour and workspace do not load or display them.

Their hashes, timing, dimensions and capture details remain in [the historical recording manifest](showcase-media.json). These recordings are separate from the current artwork.

## Build

```sh
python scripts/build_showcase.py --output /new/static-output
```

The static builder copies the page, artwork, code, fonts and retained assets into a new directory. It does not open a workspace or include a browser-selected song. Current artwork needs no video encoding step.

See [artwork provenance](artwork.md) and [third-party notices](../THIRD_PARTY_NOTICES.md) for sources and licences.
