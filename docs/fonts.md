# Fonts

Version 0.10 uses separate Chinese heading and body faces. All files are bundled; no font service is needed at runtime.

| Area | Latin | Chinese |
| --- | --- | --- |
| Presentation headings | Inter | Noto Serif SC, weight 500 |
| Presentation body and controls | Inter | Noto Sans SC |
| Listening workspace | Geist | Noto Sans SC |

The presentation's Chinese serif subset is `static/tour/score-serif.woff2`. Presentation body text uses `static/tour/score-sans.woff2`, a small interface subset of Noto Sans SC. The listening workspace retains the broader `static/studio-cjk.woff2` file for filenames and notes. The body subset includes common GB2312 characters; text outside its coverage can fall back to the system sans-serif face. Font synthesis is disabled.

## Current heading build

Pinned source URLs, input/output SHA-256 values, glyph coverage and variable-weight ranges are in `scripts/fonts/score.json`. The complete serif OFL licence is stored beside the output. The Noto Sans SC file keeps its existing licence and bytes.

In a development environment:

```sh
python -m pip install -r scripts/fonts/requirements.txt
python scripts/build_score_type.py --download
```

The command downloads missing sources at the pinned Google Fonts revision into the ignored `.font-build/score` directory. It checks their digests, subsets Noto Serif SC to the interface text and ordinary punctuation, and retains variable weights 400–600. It also verifies the existing Noto Sans SC file, creates the small presentation body subset, and checks both weight range and interface coverage.

Add new interface wording before rebuilding. A source directory can be supplied with `--source-dir /path/to/font-sources`; it must contain the pinned `NotoSerifSC[wght].ttf` and `OFL.txt`. FontTools and Brotli are maintenance tools, not application runtime dependencies.

## Earlier files

Inter, Manrope and the Noto Sans SC subsets were introduced before 0.10. Their original build records remain in `scripts/fonts/bundle.json`; `scripts/build_fonts.py --download` rebuilds those pinned assets.

The Geist subset and unchanged official MiSans file from 0.8/0.9 remain in the package for older pages. Their source records are in `scripts/fonts/sources.json` and `scripts/fonts/studio.json`; `python -m scripts.build_studio_fonts --source-dir /path/to/font-sources` maintains that set. MiSans is no longer the active Chinese face in 0.10.

See [third-party notices](../THIRD_PARTY_NOTICES.md) for the separate font licences.
