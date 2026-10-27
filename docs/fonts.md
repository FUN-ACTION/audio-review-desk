# Fonts

Version 0.11 restores the unchanged MiSans Regular file used in 0.9. It is the Chinese face for both the tour and the listening workspace. All fonts are bundled; normal use does not contact a font service.

| Area                             | Latin                  | Chinese                    |
| -------------------------------- | ---------------------- | -------------------------- |
| Tour headings, body and controls | Inter, weights 400–700 | MiSans Regular, weight 400 |
| Listening workspace              | Geist, weights 100–900 | MiSans Regular, weight 400 |

`static/fonts.css` maps `Desk Text` and `Desk Display` to `geist-latin.woff2`, and `Desk UI CJK` and `Desk CJK` to `MiSans-Regular.woff2`. The tour adds `Tour Grotesk`, backed by the Inter subset in `studio-latin.woff2`. Font synthesis is disabled. Characters outside a declared font range can use the system fallback.

## Active files

MiSans is embedded as supplied, without changing its glyphs, names or bytes. Its source and digest are recorded in `scripts/fonts/sources.json` and `scripts/fonts/studio.json`, alongside the Geist build. The Inter subset is recorded in `scripts/fonts/bundle.json`.

To maintain those pinned files:

```sh
python -m pip install -r scripts/fonts/requirements.txt
python -m scripts.build_studio_fonts --source-dir /path/to/font-sources
python scripts/build_fonts.py --download
```

Use the input files specified by the manifests. FontTools and Brotli are maintenance tools, not application runtime dependencies. Separate font licences are listed in [third-party notices](../THIRD_PARTY_NOTICES.md).

## Retained 0.10 subsets

The 0.10 tour used `static/tour/score-serif.woff2` for Chinese headings and `static/tour/score-sans.woff2` for body text. The workspace used the broader Noto Sans SC file, `static/studio-cjk.woff2`. Those files and their licences remain in the package, but the 0.11 stylesheets do not select them. Historical 0.10 recordings still show that typography.

`scripts/fonts/score.json` records the pinned source URLs, digests, glyph coverage and variable-weight ranges. The serif subset retains weights 400–600; the sans subsets retain weights 400–700. To maintain the older set:

```sh
python scripts/build_score_type.py --download
```

The command checks pinned source bytes and interface coverage before writing the subsets. It accepts `--source-dir /path/to/font-sources` for local source files. Manrope and earlier Noto Sans SC subsets also remain documented in `scripts/fonts/bundle.json`.
