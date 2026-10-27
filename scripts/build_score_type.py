"""Build the presentation's Chinese heading subset from an OFL-pinned source."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
import shutil
import string
import sys
from pathlib import Path
from urllib.request import urlopen

COMMIT = "2e61f4355afd22b801791b0df176065082423b87"
SOURCE_NAME = "NotoSerifSC[wght].ttf"
SOURCE_SHA256 = "050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9"
LICENSE_SHA256 = "5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6"
SOURCE_BASE = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl/notoserifsc/"
SANS_SHA256 = "fa329649387f845a16c3db0e2021f70e369a8a28830f250d0593bf36152ec8a9"


def license_digest(data: bytes) -> str:
    """Hash license text consistently across Git's LF/CRLF checkouts."""
    return hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest()


def checked_source(path: Path, name: str, expected: str, download: bool) -> bytes:
    if not path.is_file() and download:
        url = SOURCE_BASE + name.replace("[", "%5B").replace("]", "%5D")
        with urlopen(url, timeout=90) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError(f"Downloaded source did not match its pinned digest: {name}")
        path.write_bytes(data)
    if not path.is_file():
        raise ValueError(f"Missing {path}; pass --download to fetch the pinned source")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f"Source digest mismatch: {name}")
    return data


def build(source_dir: Path, download: bool = False) -> dict:
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    repo = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo))
    from scripts.build_fonts import ui_characters

    static = repo / "src/audio_review_desk/static"
    destination = static / "tour"
    source_dir.mkdir(parents=True, exist_ok=True)
    original = source_dir / SOURCE_NAME
    checked_source(original, SOURCE_NAME, SOURCE_SHA256, download)
    license_path = source_dir / "OFL.txt"
    checked_source(license_path, "OFL.txt", LICENSE_SHA256, download)

    ui = ui_characters(static)
    # Keep ordinary punctuation in the file as well; CSS routes Latin to Inter.
    latin = set(range(0x20, 0x250)) | set(range(0x2000, 0x2070))
    characters = ui | latin | {0x2192, 0x2197, 0x2212}
    font = TTFont(original, recalcTimestamp=False)
    if not ui <= set(font.getBestCmap()):
        missing = "".join(map(chr, sorted(ui - set(font.getBestCmap()))))
        raise ValueError(f"Pinned serif source lacks interface characters: {missing}")

    # Subset before limiting variable axes, so the 25MB CJK source is not
    # instantiated in full. Only the UI's glyphs and their layout dependencies
    # need to remain in the shipped heading file.
    options = subset.Options()
    options.recalc_timestamp = False
    options.name_IDs = ["*"]
    worker = subset.Subsetter(options=options)
    worker.populate(unicodes=characters)
    worker.subset(font)
    font = instantiateVariableFont(font, {"wght": (400, 600)}, inplace=True, updateFontNames=True)
    if "gvar" in font:
        font["gvar"].variations = {
            glyph: font["gvar"].variations.get(glyph, []) for glyph in font.getGlyphOrder()
        }
    font.flavor = "woff2"
    output = destination / "score-serif.woff2"
    font.save(output)
    checked = TTFont(output)
    assert ui <= set(checked.getBestCmap())
    assert [(axis.axisTag, axis.minValue, axis.maxValue) for axis in checked["fvar"].axes] == [("wght", 400, 600)]

    # Reuse the project's existing broad Chinese sans subset unchanged.
    sans_path = static / "studio-cjk.woff2"
    assert hashlib.sha256(sans_path.read_bytes()).hexdigest() == SANS_SHA256
    sans = TTFont(sans_path)
    if not ui <= set(sans.getBestCmap()):
        missing = "".join(map(chr, sorted(ui - set(sans.getBestCmap()))))
        raise ValueError(f"Existing Noto Sans SC body subset needs expansion: {missing}")
    assert [(axis.axisTag, axis.minValue, axis.maxValue) for axis in sans["fvar"].axes] == [("wght", 400, 700)]
    # The presentation has fixed copy, so it need not download the broad body
    # face used for arbitrary filenames in the listening workspace.
    small_sans = TTFont(sans_path, recalcTimestamp=False)
    sans_options = subset.Options()
    sans_options.recalc_timestamp = False
    sans_options.name_IDs = ["*"]
    sans_worker = subset.Subsetter(options=sans_options)
    punctuation = {ord(char) for char in string.punctuation + " "} | set(range(0x2000, 0x2070))
    sans_worker.populate(unicodes=ui | punctuation)
    sans_worker.subset(small_sans)
    if "gvar" in small_sans:
        small_sans["gvar"].variations = {
            glyph: small_sans["gvar"].variations.get(glyph, []) for glyph in small_sans.getGlyphOrder()
        }
    small_sans.flavor = "woff2"
    sans_output = destination / "score-sans.woff2"
    small_sans.save(sans_output)
    checked_sans = TTFont(sans_output)
    assert ui <= set(checked_sans.getBestCmap())
    assert [(axis.axisTag, axis.minValue, axis.maxValue) for axis in checked_sans["fvar"].axes] == [("wght", 400, 700)]
    shutil.copyfile(license_path, destination / "score-serif-OFL.txt")
    record = dict(
        build=dict(python=platform.python_version(), fonttools=importlib.metadata.version("fonttools"), brotli=importlib.metadata.version("brotli")),
        license_digest_format="UTF-8 with LF line endings",
        fonts=[
            dict(file="tour/score-serif.woff2", family="Noto Serif SC", css_family="Score Serif SC",
                 weights=[400, 600], source=SOURCE_BASE + "NotoSerifSC%5Bwght%5D.ttf", source_commit=COMMIT,
                 source_sha256=SOURCE_SHA256, sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                 bytes=output.stat().st_size, glyphs=len(checked.getBestCmap()), license="OFL-1.1",
                 license_file="tour/score-serif-OFL.txt", license_sha256=LICENSE_SHA256),
            dict(file="tour/score-sans.woff2", family="Noto Sans SC", css_family="Score Sans SC", weights=[400, 700],
                 input_file="studio-cjk.woff2", input_sha256=SANS_SHA256,
                 source="https://raw.githubusercontent.com/google/fonts/2894aab31764f10f29c421bdfd2340d3b382d384/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf",
                 source_sha256="a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da",
                 sha256=hashlib.sha256(sans_output.read_bytes()).hexdigest(), bytes=sans_output.stat().st_size,
                 glyphs=len(checked_sans.getBestCmap()), license="OFL-1.1", license_file="notosanssc-OFL.txt",
                 license_sha256=license_digest((static / "notosanssc-OFL.txt").read_bytes())),
            dict(file="studio-cjk.woff2", family="Noto Sans SC", css_family="Score Sans SC", weights=[400, 700],
                 source="https://raw.githubusercontent.com/google/fonts/2894aab31764f10f29c421bdfd2340d3b382d384/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf",
                 source_sha256="a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da",
                 sha256=SANS_SHA256, bytes=sans_path.stat().st_size, glyphs=len(sans.getBestCmap()),
                 license="OFL-1.1", license_file="notosanssc-OFL.txt",
                 license_sha256=license_digest((static / "notosanssc-OFL.txt").read_bytes()),
                 reused_unchanged=True),
        ],
        ui_cjk_unicodes=sorted(ui),
        note="Presentation Chinese body and control text uses the small Noto Sans SC subset; the listening workspace keeps the broad Noto Sans SC file for arbitrary filenames. Presentation headings use this Noto Serif SC subset. Latin remains Inter in the presentation and Geist in the workspace.",
    )
    (repo / "scripts/fonts/score.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps([dict(file=f["file"], bytes=f["bytes"], weights=f["weights"]) for f in record["fonts"]]))
    return record


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=Path(".font-build/score"))
    parser.add_argument("--download", action="store_true", help="Fetch missing sources at the pinned revision")
    arguments = parser.parse_args()
    build(arguments.source_dir, arguments.download)
