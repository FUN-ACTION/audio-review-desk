# Third-party fonts

The application bundles subsets of these fonts for offline use. The application code is MIT-licensed; the font files retain their own SIL Open Font License 1.1.

- **Inter**, by the Inter Project Authors: [source](https://github.com/google/fonts/tree/main/ofl/inter), [license](src/audio_review_desk/static/inter-OFL.txt). The bundled Latin subset uses optical size 14 and weights 400–700.
- **Noto Sans SC**, by the Noto Project Authors: [source](https://github.com/google/fonts/tree/main/ofl/notosanssc), [license](src/audio_review_desk/static/notosanssc-OFL.txt). The bundled subset includes common GB2312 Chinese characters, Latin and punctuation, at weights 400–700. Other characters use the system sans-serif fallback.

No fonts are fetched from a third-party server while using the app.

## Motion 14.6.0

The bundled `static/motion-vendor.js` contains Motion, framer-motion, motion-dom and motion-utils, all pinned to 14.6.0. They are distributed under the MIT licence. Full copyright and licence text is included in [motion-LICENSE.txt](src/audio_review_desk/static/motion-LICENSE.txt).

Source: [motiondivision/motion](https://github.com/motiondivision/motion). The build entry, exact dependency lock and output hash are in `scripts/motion-build/`. Normal application use does not contact a CDN or package registry.
