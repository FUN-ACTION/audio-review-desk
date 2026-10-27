# Third-party fonts

The application bundles subsets of these fonts for offline use. The application code is MIT-licensed; the font files retain their own SIL Open Font License 1.1.

- **Manrope**, by Mikhail Sharanda and the Manrope Project Authors: [source](https://github.com/google/fonts/tree/main/ofl/manrope), [license](src/audio_review_desk/static/manrope-OFL.txt). The display subset includes Latin and punctuation at weights 400–700.
- **Inter**, by the Inter Project Authors: [source](https://github.com/google/fonts/tree/main/ofl/inter), [license](src/audio_review_desk/static/inter-OFL.txt). The bundled Latin subset uses optical size 14 and weights 400–700.
- **Noto Sans SC**, by the Noto Project Authors: [source](https://github.com/google/fonts/tree/main/ofl/notosanssc), [license](src/audio_review_desk/static/notosanssc-OFL.txt). A small subset covers the Chinese interface; a second subset covers common GB2312 Chinese characters for filenames and notes. Both use weights 400–700. Characters outside those subsets use the system sans-serif fallback.

No fonts are fetched from a third-party server while using the app.

## Motion 14.6.0

The bundled `static/motion-vendor.js` contains Motion, framer-motion, motion-dom and motion-utils, all pinned to 14.6.0. They are distributed under the MIT licence. Full copyright and licence text is included in [motion-LICENSE.txt](src/audio_review_desk/static/motion-LICENSE.txt).

Source: [motiondivision/motion](https://github.com/motiondivision/motion). The build entry, exact dependency lock and output hash are in `scripts/motion-build/`. Normal application use does not contact a CDN or package registry.

## Rebuilding the legacy fonts

Pinned source revisions, original-file digests and output digests are recorded in `scripts/fonts/bundle.json`. `scripts/build_fonts.py` uses FontTools and Brotli during maintenance; the application does not import them. The record also identifies the build-library versions. The build checks that every Chinese interface character has a glyph in the small subset.

```sh
python -m pip install -r scripts/fonts/requirements.txt
python scripts/build_fonts.py --download
```

This downloads the pinned source files once into the ignored `.font-build/sources` directory. Normal app and site use reads the bundled WOFF2 files locally.


For the current build, see [the Geist and MiSans guide](docs/fonts.md).

## Typeface update in 0.8

The interface uses Geist for Latin text and MiSans for Chinese text.

- Geist: [Google Fonts source](https://github.com/google/fonts/tree/718e1db4deb9e4d9d85a0ead1b9f5fde2761ccfd/ofl/geist), SIL Open Font License 1.1. The Latin web subset is built from the pinned source; see `static/geist-OFL.txt` and `scripts/fonts/studio.json`.
- MiSans: Copyright Xiaomi Inc. Embedded as the official, unchanged `MiSans-Regular.woff2`. The [official FAQ](https://hyperos.mi.com/font/en/faq/) permits embedded use with attribution. The complete supplied [licence](src/audio_review_desk/static/MiSans-License.pdf) applies to the font; it is not covered by the application's MIT licence. No glyph, font name or font bytes were modified. The Help panel and website font link identify MiSans.

The 0.7 font files are retained for older-page compatibility; the 0.8 interface does not request them.
