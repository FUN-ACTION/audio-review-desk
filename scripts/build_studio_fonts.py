"""Prepare the 0.8 type system; keep the official MiSans WOFF2 unchanged."""
import argparse
import hashlib
import json
import shutil
import importlib.metadata
import platform
from pathlib import Path
from scripts.build_fonts import ui_characters

def build(source_dir: Path):
    from fontTools import subset
    from fontTools.ttLib import TTFont
    repo = Path(__file__).resolve().parents[1]
    static = repo / 'src/audio_review_desk/static'
    metadata = json.loads((repo/'scripts/fonts/sources.json').read_text(encoding='utf-8'))['geist']
    original = source_dir/'Geist.ttf'
    if hashlib.sha256(original.read_bytes()).hexdigest() != metadata['sha256']:
        raise ValueError('The Geist source does not match the pinned digest')
    font = TTFont(original, recalcTimestamp=False)
    options = subset.Options()
    options.recalc_timestamp = False
    options.name_IDs = ['*']
    worker = subset.Subsetter(options=options)
    worker.populate(unicodes=set(range(0x20,0x250))|set(range(0x2000,0x2070))|{0x2192,0x2197,0x2212})
    worker.subset(font)
    font.flavor = 'woff2'
    font.save(static/'geist-latin.woff2')
    misans = source_dir/'MiSans-Regular.woff2'
    digest = 'd704c1a932c0bd7e8a071d276cd81c0ed0c9fecfa26ac234f4bed0559fe1cb2d'
    if hashlib.sha256(misans.read_bytes()).hexdigest() != digest:
        raise ValueError('The MiSans source does not match the official unchanged file')
    shutil.copyfile(misans,static/misans.name)
    characters = ui_characters(static)
    if not characters <= set(TTFont(misans).getBestCmap()):
        raise ValueError('MiSans does not cover the interface')
    records=[]
    for name,family,source,original_sha,unchanged in [
        ('geist-latin.woff2','Geist',metadata['url'],metadata['sha256'],False),
        (misans.name,'MiSans','https://hyperos.mi.com/font-download/MiSans.zip',digest,True),
    ]:
        data=(static/name).read_bytes()
        records.append(dict(file=name,family=family,source=source,source_sha256=original_sha,
                            sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),unchanged=unchanged))
    report=dict(build=dict(python=platform.python_version(),fonttools=importlib.metadata.version("fonttools"),brotli=importlib.metadata.version("brotli")),fonts=records,ui_cjk_unicodes=sorted(characters),
                misans_license='https://hyperos.mi.com/font/en/faq/',
                note='MiSans is embedded as supplied, without glyph, name, or binary changes. Geist subset under OFL.')
    (repo/'scripts/fonts/studio.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps([dict(file=r['file'],bytes=r['bytes']) for r in records]))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir',type=Path,required=True)
    build(parser.parse_args().source_dir)
