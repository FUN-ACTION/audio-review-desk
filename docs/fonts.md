# Fonts

The project bundles Inter, Geist and the unchanged MiSans Regular file restored in 0.11. The tour also uses platform fonts where available. Normal use does not contact a font service.

| Area                             | Latin                  | Chinese                    |
| -------------------------------- | ---------------------- | -------------------------- |
| Tour headings, body and controls | Inter, bundled weights 400–700 | Platform fallback, then MiSans Regular for supported characters |
| Listening workspace              | Geist, weights 100–900 | MiSans Regular, weight 400 |

`static/fonts.css` maps `Desk Text` and `Desk Display` to `geist-latin.woff2`, and `Desk UI CJK` and `Desk CJK` to `MiSans-Regular.woff2`. The active `static/tour/tour.css` adds `Review Studio`, backed by the Inter subset in `studio-latin.woff2`. Its stack is `Review Studio`, `-apple-system`, `BlinkMacSystemFont`, `PingFang SC`, `Desk UI CJK`, `Segoe UI`, then `sans-serif`. The CSS declares the bundled Inter subset's actual 400–700 weight range. The workspace selects `Desk Text`, `Desk UI CJK` and `Desk CJK` before system fallbacks and disables font synthesis. Characters outside a declared font range can use fallback fonts.

## Active files

MiSans is embedded as supplied, without changing its glyphs, names or bytes. Its source and digest are recorded in `scripts/fonts/sources.json` and `scripts/fonts/studio.json`, alongside the Geist build. The Inter subset is recorded in `scripts/fonts/bundle.json`.

To maintain those pinned files:

```sh
python -m pip install -r scripts/fonts/requirements.txt
python -m scripts.build_studio_fonts --source-dir /path/to/font-sources
python scripts/build_fonts.py --download
```

Use the input files specified by the manifests. FontTools and Brotli are maintenance tools, not application runtime dependencies. Separate font licences are listed in [third-party notices](../THIRD_PARTY_NOTICES.md).

After copy-only changes, run `python -m scripts.build_studio_fonts --verify-coverage`. This checks the shipped font hashes and actual MiSans cmap before updating the recorded interface characters. It preserves the original build provenance and does not change font bytes or require source downloads. If characters are missing, the check fails instead of recording unsupported coverage.

## Retained 0.10 subsets

The 0.10 tour used `static/tour/score-serif.woff2` for Chinese headings and `static/tour/score-sans.woff2` for body text. The workspace used the broader Noto Sans SC file, `static/studio-cjk.woff2`. Those files and their licences remain in the package, but the current tour and workspace stylesheets do not select them. Historical 0.10 recordings still show that typography.

`scripts/fonts/score.json` records the pinned source URLs, digests, glyph coverage and variable-weight ranges. The serif subset retains weights 400–600; the sans subsets retain weights 400–700. To maintain the older set:

```sh
python scripts/build_score_type.py --download
```

The command checks pinned source bytes and interface coverage before writing the subsets. It accepts `--source-dir /path/to/font-sources` for local source files. Manrope and earlier Noto Sans SC subsets also remain documented in `scripts/fonts/bundle.json`.
