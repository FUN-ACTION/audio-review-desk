"""Build the bundled fonts from pinned sources (maintenance only)."""
from __future__ import annotations

import argparse
import hashlib
import json
import importlib.metadata
import platform
from pathlib import Path
from urllib.request import urlopen

SOURCES = {
    "manrope": ("Manrope[wght].ttf", "b31870aff700ab7a1d74fa0c6887d95beb9e0037", "3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6"),
    "inter": ("Inter[opsz,wght].ttf", "e1d6480102fed30739fead0faee463101f892c8f", "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031"),
    "notosanssc": ("NotoSansSC[wght].ttf", "2894aab31764f10f29c421bdfd2340d3b382d384", "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da"),
}


def ui_characters(static: Path) -> set[int]:
    result = set()
    for path in sorted(static.rglob("*")):
        if path.suffix in {".html", ".js"} and path.name != "motion-vendor.js":
            result.update(ord(char) for char in path.read_text(encoding="utf-8")
                          if 0x2e80 <= ord(char) <= 0x9fff or 0xf900 <= ord(char) <= 0xfaff or 0xff00 <= ord(char) <= 0xffef)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=Path(".font-build/sources"))
    parser.add_argument("--download", action="store_true", help="Fetch missing sources at the pinned revisions")
    args = parser.parse_args()
    from fontTools.ttLib import TTFont
    from fontTools import subset
    from fontTools.varLib.instancer import instantiateVariableFont

    repo = Path(__file__).resolve().parents[1]
    static = repo / "src/audio_review_desk/static"
    args.source_dir.mkdir(parents=True, exist_ok=True)
    sources = {}
    for family, (filename, commit, digest) in SOURCES.items():
        source = args.source_dir / filename
        url = f"https://raw.githubusercontent.com/google/fonts/{commit}/ofl/{family}/{filename.replace('[','%5B').replace(']','%5D')}"
        if not source.is_file() and args.download:
            with urlopen(url, timeout=60) as response:
                source.write_bytes(response.read())
        if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Missing or mismatched font source: {filename}")
        sources[family] = dict(source=source, url=url, sha256=digest)
    latin = set(range(0x20, 0x250)) | set(range(0x2000, 0x2070)) | set(range(0xff00, 0xffef))
    common = set(range(0x3000, 0x3040)) | latin
    for code in range(0x4e00, 0xa000):
        try:
            chr(code).encode("gb2312")
            common.add(code)
        except UnicodeEncodeError:
            pass
    ui = ui_characters(static)
    records = []
    for family, output, characters in [
        ("manrope", "desk-display.woff2", latin),
        ("inter", "studio-latin.woff2", latin),
        ("notosanssc", "studio-cjk.woff2", common | ui),
        ("notosanssc", "desk-cjk-ui.woff2", ui),
    ]:
        font = TTFont(sources[family]["source"], recalcTimestamp=False)
        axes = {"wght": (400, 700)}
        if family == "inter":
            axes["opsz"] = 14
        font = instantiateVariableFont(font, axes, inplace=True, updateFontNames=True)
        if "gvar" in font:
            font["gvar"].variations = {glyph: font["gvar"].variations.get(glyph, []) for glyph in font.getGlyphOrder()}
        options = subset.Options()
        options.flavor, options.recalc_timestamp, options.name_IDs = "woff2", False, ["*"]
        worker = subset.Subsetter(options=options)
        worker.populate(unicodes=characters)
        worker.subset(font)
        font.flavor = "woff2"
        target = static / output
        font.save(target)
        checked = TTFont(target)
        if output == "desk-cjk-ui.woff2":
            assert ui <= set(checked.getBestCmap())
        records.append(dict(file=output, family=family, source=sources[family]["url"], source_sha256=sources[family]["sha256"],
                            sha256=hashlib.sha256(target.read_bytes()).hexdigest(), bytes=target.stat().st_size,
                            glyphs=len(checked.getBestCmap()), weights=[400, 700]))
    report = dict(build=dict(python=platform.python_version(), fonttools=importlib.metadata.version("fonttools"), brotli=importlib.metadata.version("brotli")), fonts=records, ui_cjk_unicodes=sorted(ui))
    (repo / "scripts/fonts/bundle.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps([dict(file=record["file"], bytes=record["bytes"], glyphs=record["glyphs"]) for record in records]))


if __name__ == "__main__":
    main()
