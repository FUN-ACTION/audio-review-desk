# Fonts

The current UI uses Geist for Latin text and MiSans Regular for Chinese. Files are bundled, so the installed application needs no font service. MiSans is the official, unchanged WOFF2 file; it adds about 4.9 MB. Older font files remain in the package for cached pages from previous versions.

Pinned URLs and SHA-256 values are in `scripts/fonts/sources.json`. Licences are included beside the fonts and listed in [third-party notices](../THIRD_PARTY_NOTICES.md).

To rebuild the font manifest:

1. Download the pinned Geist TTF and official MiSans ZIP from the URLs in that file.
2. Put `Geist.ttf` and the ZIP member `MiSans/woff2/MiSans-Regular.woff2` in a separate source directory.
3. In a development environment with fontTools 4.61.1 and Brotli support, run `python -m scripts.build_studio_fonts --source-dir /path/to/font-sources` from the repository root.

The script verifies both inputs, subsets Geist under its OFL licence, copies MiSans without modification, and verifies Chinese interface character coverage. It does not need a training environment. Add new UI wording before rebuilding the manifest.
