"""Optional maintainer tool: pip install fonttools[woff]. Not needed to run the app."""
import hashlib
from pathlib import Path
from urllib.request import urlretrieve

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.font-build'
TARGET = ROOT / 'src' / 'audio_review_desk' / 'static'
SOURCES = [
    ('notosanssc', 'NotoSansSC[wght].ttf', 'studio-cjk.woff2', True,
     'a85815a42757630ce188fdad368c2dfc444d4773', 'a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da'),
    ('inter', 'Inter[opsz,wght].ttf', 'studio-latin.woff2', False,
     '0b58fb370093f9a9f4ff785d94405710b79de67c', '29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031'),
]


def main():
    CACHE.mkdir(exist_ok=True)
    for family, filename, output, chinese, revision, expected in SOURCES:
        base = f'https://raw.githubusercontent.com/google/fonts/{revision}/ofl/{family}/'
        source = CACHE / filename
        if not source.exists():
            urlretrieve(base + filename.replace('[', '%5B').replace(']', '%5D'), source)
        if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
            raise ValueError(f'Unexpected font source: {filename}')
        urlretrieve(base + 'OFL.txt', TARGET / (family + '-OFL.txt'))
        license_path = TARGET / (family + '-OFL.txt')
        license_path.write_text('\n'.join(line.rstrip() for line in license_path.read_text(encoding='utf-8').splitlines()) + '\n', encoding='utf-8')
        font = TTFont(source)
        axes = {'wght': (400, 700)}
        if not chinese:
            axes['opsz'] = 14
        font = instantiateVariableFont(font, axes, inplace=True)
        if 'gvar' in font:
            # Some glyphs have no deltas after axis restriction.
            font['gvar'].variations = {g: font['gvar'].variations.get(g, []) for g in font.getGlyphOrder()}
        chars = set(range(0x20, 0x250)) | set(range(0x2000, 0x2070)) | set(range(0xff00, 0xffef))
        if chinese:
            chars.update(range(0x3000, 0x3040))
            for code in range(0x4e00, 0xa000):
                try:
                    chr(code).encode('gb2312')
                    chars.add(code)
                except UnicodeEncodeError:
                    pass
        options = subset.Options()
        options.recalc_timestamp = False
        options.name_IDs = ['*']
        worker = subset.Subsetter(options=options)
        worker.populate(unicodes=chars)
        worker.subset(font)
        font.flavor = 'woff2'
        font.save(TARGET / output)
        print(f'{output}: {(TARGET / output).stat().st_size} bytes')


if __name__ == '__main__':
    main()
