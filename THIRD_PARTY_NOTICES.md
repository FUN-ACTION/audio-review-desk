# Third-party notices

The application code is MIT-licensed. Bundled libraries and fonts retain the licences listed below.

## Bundled OFL fonts

These subsets are included for offline use under the SIL Open Font License 1.1.

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

The review workspace uses Geist for Latin text and MiSans for Chinese text. The 0.9 website uses the bundled Inter Latin subset through the Tour Grotesk alias, with regular-weight large headings, and the same MiSans file for Chinese.

- Geist: [Google Fonts source](https://github.com/google/fonts/tree/718e1db4deb9e4d9d85a0ead1b9f5fde2761ccfd/ofl/geist), SIL Open Font License 1.1. The Latin web subset is built from the pinned source; see `static/geist-OFL.txt` and `scripts/fonts/studio.json`.
- MiSans: Copyright Xiaomi Inc. Embedded as the official, unchanged `MiSans-Regular.woff2`. The [official FAQ](https://hyperos.mi.com/font/en/faq/) permits embedded use with attribution. The complete supplied [licence](src/audio_review_desk/static/MiSans-License.pdf) applies to the font; it is not covered by the application's MIT licence. No glyph, font name or font bytes were modified. The Help panel and website font link identify MiSans.

Manrope and Noto Sans SC files remain for older-page compatibility. The current website also uses the bundled Inter file.


## Three.js 0.180.0

The local scene-vendor.js bundle contains Three.js 0.180.0 and its RoomEnvironment and MarchingCubes addons, under the MIT licence. The supplied copyright and licence text is in [three-LICENSE.txt](src/audio_review_desk/static/tour/three-LICENSE.txt).

Source: [mrdoob/three.js](https://github.com/mrdoob/three.js). The entry, exact dependency lock and output digest are in scripts/scene-build, including package-lock.json and bundle.json. To rebuild:

```sh
npm ci --prefix scripts/scene-build
node scripts/scene-build/build.mjs
```

Normal use loads the bundled file locally and does not request Three.js from a CDN. Node.js and the build tools are needed only for maintenance.

The connector geometry, small physics simulation, reel shader and controllers are project code. [Lusion](https://lusion.co/) is a visual and interaction reference; its source bundle, photographs, videos, models, textures, logos and proprietary fonts are not redistributed.
