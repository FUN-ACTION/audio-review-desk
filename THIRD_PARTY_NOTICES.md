# Third-party notices

The application code is MIT-licensed. Bundled libraries and fonts retain their own licences.

## Active typefaces in 0.11

- **MiSans** is Copyright Xiaomi Inc. The official, unchanged `MiSans-Regular.woff2` is the Chinese face for the tour and review workspace, restoring the 0.9 selection. No glyph, name or font bytes were modified. Its supplied [licence](src/audio_review_desk/static/MiSans-License.pdf), together with the [official font FAQ](https://hyperos.mi.com/font/en/faq/), applies to the font; the application's MIT licence does not relicense it. The source and digest are recorded in `scripts/fonts/sources.json` and `scripts/fonts/studio.json`.
- **Inter** is used for Latin text in the presentation. The bundled subset uses optical size 14 and weights 400–700 under the SIL Open Font License 1.1. See [source](https://github.com/google/fonts/tree/main/ofl/inter) and [licence](src/audio_review_desk/static/inter-OFL.txt).
- **Geist** is used for Latin text in the review workspace under the SIL Open Font License 1.1. See the pinned [Google Fonts source](https://github.com/google/fonts/tree/718e1db4deb9e4d9d85a0ead1b9f5fde2761ccfd/ofl/geist), [licence](src/audio_review_desk/static/geist-OFL.txt) and `scripts/fonts/studio.json`.

Fonts are served from bundled files. Normal use does not contact a font service. [Font maintenance](docs/fonts.md) explains the current build and retained assets.

## Retained font files

**Manrope**, by Mikhail Sharanda and the Manrope Project Authors, remains packaged for older pages. Its Latin and punctuation subset uses weights 400–700 under the SIL Open Font License 1.1. See [source](https://github.com/google/fonts/tree/main/ofl/manrope) and [licence](src/audio_review_desk/static/manrope-OFL.txt).

**Noto Serif SC** was used for Chinese tour headings in 0.10. Its retained variable subset has weights 400–600 and is distributed under the SIL Open Font License 1.1. Copyright and licence text are preserved in [score-serif-OFL.txt](src/audio_review_desk/static/tour/score-serif-OFL.txt). The pinned [Google Fonts source](https://github.com/google/fonts/tree/2e61f4355afd22b801791b0df176065082423b87/ofl/notoserifsc), source digest, output digest and glyph coverage are recorded in `scripts/fonts/score.json`.

**Noto Sans SC** was used for Chinese body text and controls in 0.10. The retained files include `static/tour/score-sans.woff2`, the broader `static/studio-cjk.woff2` file and the earlier small UI subset. They retain weights 400–700 under the SIL Open Font License 1.1. See the pinned [Google Fonts source](https://github.com/google/fonts/tree/2894aab31764f10f29c421bdfd2340d3b382d384/ofl/notosanssc) and complete [licence](src/audio_review_desk/static/notosanssc-OFL.txt), including its copyright and reserved-font-name notice. The 0.11 stylesheets do not select these subsets; historical 0.10 recordings still show them.

Original-file and output digests for earlier font builds remain in `scripts/fonts/bundle.json`, `scripts/fonts/sources.json` and `scripts/fonts/studio.json`. FontTools and Brotli are used only during maintenance. Their pinned versions are in `scripts/fonts/requirements.txt`.

## Motion 14.6.0

The bundled `static/motion-vendor.js` contains Motion, framer-motion, motion-dom and motion-utils, all pinned to 14.6.0. They are distributed under the MIT licence. Full copyright and licence text is included in [motion-LICENSE.txt](src/audio_review_desk/static/motion-LICENSE.txt).

Source: [motiondivision/motion](https://github.com/motiondivision/motion). The build entry, exact dependency lock and output hash are in `scripts/motion-build/`. Normal application use does not contact a CDN or package registry.

## Three.js 0.180.0

The local `scene-vendor.js` bundle contains Three.js 0.180.0 and its RoomEnvironment and MarchingCubes addons, under the MIT licence. Copyright and licence text are preserved in [three-LICENSE.txt](src/audio_review_desk/static/tour/three-LICENSE.txt).

Source: [mrdoob/three.js](https://github.com/mrdoob/three.js). Its entry, exact dependency lock and output digest are in `scripts/scene-build/`. To rebuild the pinned bundle:

```sh
npm ci --prefix scripts/scene-build
node scripts/scene-build/build.mjs
```

The 0.11 tour uses this bundle for the musical-note scene, including CPU volume meshing with MarchingCubes and environment lighting with RoomEnvironment. The earlier reel-warp module remains packaged for older pages and is not imported by the current tour.

## Project artwork and reference studies

The musical-note curves, volume fields, clef ribbon, SVG fallback, body interaction and synthesized piano sample are project code. The three further music compositions use original procedural meshes and material shaders in `music-art.js` and `music-shader.js`. The current tour contains no videos or software-operation illustrations.

Six application recordings remain packaged from 0.10. They were captured using generated test signals and complete application frames. Their source and timing are documented in [media notes](docs/showcase-media.md); the 0.11 tour does not load them.

[Lusion](https://lusion.co/) and [Superlist](https://www.superlist.com/) informed earlier reference studies. Their source bundles, models, textures, photographs, films, logos and proprietary font files are not redistributed.
