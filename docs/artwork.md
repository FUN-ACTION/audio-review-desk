# Artwork

The website's three CGI-style PNGs were newly generated for Audio Review Desk with the built-in ImageGen tool. They are stored in `src/audio_review_desk/static/tour/media/`.

| File | Image | Dimensions |
| --- | --- | --- |
| `art-bloom.png` | Dark glass petals with a sound-wave form | 1672 × 941 |
| `art-wave.png` | Warm white acoustic sheets | 1672 × 941 |
| `art-prism.png` | Violet optical prism | 1672 × 940 |

The images do not include a user-supplied PDF score, a local song or an artist recording.

## Depth relief

[art-stage.js](../src/audio_review_desk/static/tour/art-stage.js) estimates shallow depth from a smaller luminance image, then smooths it and limits neighboring height changes. That map displaces the vertices of a fine mesh. Perspective and a small range of drag rotation give the image depth. The original RGB image supplies the surface texture.

This is a single-image depth relief, not a complete 3D model. It does not reconstruct the hidden sides or the physical volume of the glass. Devices without the required vertex-texture support use the flat flow-field effect. If WebGL is unavailable or disabled, the original image stays visible.

Motion can pause. Reduced-motion preferences start it still, and continuous rendering stops offscreen or in a hidden tab. Pointer movement, scene changes and playback level can gently change the motion.

The renderer can use the amplitude level from [music-player.js](../src/audio_review_desk/static/tour/music-player.js). The default sound is an original synthesized piano-like phrase. Users can instead choose a file through a browser object URL and press Play. That file is neither uploaded nor bundled with the artwork.

## References

[Lusion](https://lusion.co/) informed the layout and interaction reference study. The PNGs listed above were generated for this project; they are not Lusion assets. The depth-map preparation, mesh and shaders are project code.

The website uses Inter and MiSans from the local font assets. Font and library licences are listed in [third-party notices](../THIRD_PARTY_NOTICES.md). Details of the retained historical media are in [media notes](showcase-media.md).
