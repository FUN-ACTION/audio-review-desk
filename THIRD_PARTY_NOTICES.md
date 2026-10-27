# Third-party notices

The application code is MIT-licensed. Bundled libraries and fonts retain their own licences.

## Current typefaces

- **Noto Serif SC** is used for Chinese presentation headings in 0.10. The variable subset retains weights 400–600 and is distributed under the SIL Open Font License 1.1. Copyright and licence text are preserved in [score-serif-OFL.txt](src/audio_review_desk/static/tour/score-serif-OFL.txt). The pinned [Google Fonts source](https://github.com/google/fonts/tree/2e61f4355afd22b801791b0df176065082423b87/ofl/notoserifsc), source digest, output digest and glyph coverage are recorded in `scripts/fonts/score.json`.
- **Noto Sans SC** is used for Chinese body text and controls in both the presentation and review workspace. Presentation text uses the small `static/tour/score-sans.woff2` interface subset; the workspace reuses the broader common-character `static/studio-cjk.woff2` file without changing its bytes. The earlier small UI subset is also retained. These subsets use weights 400–700 under the SIL Open Font License 1.1. See the pinned [Google Fonts source](https://github.com/google/fonts/tree/2894aab31764f10f29c421bdfd2340d3b382d384/ofl/notosanssc) and complete [licence](src/audio_review_desk/static/notosanssc-OFL.txt), including its copyright and reserved-font-name notice. Characters outside the subsets can use the system sans-serif fallback.
- **Inter** is used for Latin text in the presentation. The bundled subset uses optical size 14 and weights 400–700 under the SIL Open Font License 1.1. See [source](https://github.com/google/fonts/tree/main/ofl/inter) and [licence](src/audio_review_desk/static/inter-OFL.txt).
- **Geist** is used for Latin text in the review workspace under the SIL Open Font License 1.1. See the pinned [Google Fonts source](https://github.com/google/fonts/tree/718e1db4deb9e4d9d85a0ead1b9f5fde2761ccfd/ofl/geist), [licence](src/audio_review_desk/static/geist-OFL.txt) and `scripts/fonts/studio.json`.

Fonts are served from bundled files. Normal use does not contact a font service. [Font maintenance](docs/fonts.md) explains the current build and retained assets.

## Retained font files

**Manrope**, by Mikhail Sharanda and the Manrope Project Authors, remains packaged for older pages. Its Latin and punctuation subset uses weights 400–700 under the SIL Open Font License 1.1. See [source](https://github.com/google/fonts/tree/main/ofl/manrope) and [licence](src/audio_review_desk/static/manrope-OFL.txt).

**MiSans** is Copyright Xiaomi Inc. The official, unchanged `MiSans-Regular.woff2` from the 0.8/0.9 interface remains in the package for older pages. No glyph, name or font bytes were modified. Its supplied [licence](src/audio_review_desk/static/MiSans-License.pdf), together with the [official font FAQ](https://hyperos.mi.com/font/en/faq/), applies to the font; the application's MIT licence does not relicense it. MiSans is no longer the active Chinese face in 0.10.

Original-file and output digests for earlier font builds remain in `scripts/fonts/bundle.json`, `scripts/fonts/sources.json` and `scripts/fonts/studio.json`. FontTools and Brotli are used only during maintenance. Their pinned versions are in `scripts/fonts/requirements.txt`.

## Motion 14.6.0

The bundled `static/motion-vendor.js` contains Motion, framer-motion, motion-dom and motion-utils, all pinned to 14.6.0. They are distributed under the MIT licence. Full copyright and licence text is included in [motion-LICENSE.txt](src/audio_review_desk/static/motion-LICENSE.txt).

Source: [motiondivision/motion](https://github.com/motiondivision/motion). The build entry, exact dependency lock and output hash are in `scripts/motion-build/`. Normal application use does not contact a CDN or package registry.

## Retained Three.js 0.180.0 bundle

The local `scene-vendor.js` bundle contains Three.js 0.180.0 and its RoomEnvironment and MarchingCubes addons, under the MIT licence. Copyright and licence text are preserved in [three-LICENSE.txt](src/audio_review_desk/static/tour/three-LICENSE.txt).

Source: [mrdoob/three.js](https://github.com/mrdoob/three.js). Its entry, exact dependency lock and output digest remain in `scripts/scene-build/`. To rebuild this legacy bundle:

```sh
npm ci --prefix scripts/scene-build
node scripts/scene-build/build.mjs
```

The bundle and 0.9 scene/reel modules remain available for older pages. The 0.10 tour uses Canvas 2D and SVG and does not import them.

## Project artwork and reference studies

The score drawing, note interaction, synthesized sample, waveform examples and page controllers are project code. The six application recordings were captured from the 0.10 interface using generated test signals and complete application frames; their source and timing are documented in [media notes](docs/showcase-media.md).

[Lusion](https://lusion.co/) and [Superlist](https://www.superlist.com/) informed earlier reference studies. Their source bundles, models, textures, photographs, films, logos and proprietary font files are not redistributed.
