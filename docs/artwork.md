# Website artwork

The current website renders an acoustic sculpture from original project code. It uses 44 rings, shared torus geometry, a perspective camera and metallic lighting. [signal-stage.js](../src/audio_review_desk/static/tour/signal-stage.js) defines the shape and motion; the bundled Three.js renderer and room environment are covered by their existing MIT licence.

Pointer movement changes the viewpoint slightly. The amplitude of a synthesized phrase, or music selected in the browser, changes the form gently. Playback starts with a button press. Motion can be paused; reduced-motion settings start it still. Rendering stops offscreen or while the page is hidden. A CSS acoustic form remains visible if WebGL cannot initialize or its context is lost.

The three working examples use an original synthesized phrase: compare timbres at the same time position, loop a selected interval, or add and remove temporary timestamped notes. These examples do not write workspace reviews. Actual scores, ranges and review history belong to the application workspace.

## Design references

Apple's product pages informed the typography hierarchy, light navigation and feature grouping. No Apple product image, logo, font file or source code is bundled. Latin and Chinese typography uses the project's existing licensed fonts, with platform fonts where available.

## Historical artwork

The 0.12 images art-bloom.png, art-wave.png and art-prism.png were generated for this project with ImageGen. Their depth-relief renderer remains in the source history and retained assets for reproducibility. The current page does not load it or those PNGs. Earlier Lusion studies and model experiments are also inactive.

No supplied PDF score, artist song, private recording, review database or model weight is included in the artwork.

[Third-party notices](../THIRD_PARTY_NOTICES.md) · [Media](showcase-media.md) · [Verification](verification.md)
