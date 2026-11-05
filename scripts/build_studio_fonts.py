"""Prepare the 0.8 type system; keep the official MiSans WOFF2 unchanged."""
import argparse
import hashlib
import json
import shutil
import importlib.metadata
import platform
from pathlib import Path
from scripts.build_fonts import ui_characters

def refresh_coverage(repo: Path | None = None):
    """Verify shipped bytes and their actual cmap before recording new UI copy.

    This does not rebuild or rewrite either font, and does not need source downloads.
    The original build provenance remains unchanged in the manifest.
    """
    from fontTools.ttLib import TTFont
    repo = repo or Path(__file__).resolve().parents[1]
    static = repo / 'src/audio_review_desk/static'
    manifest = repo / 'scripts/fonts/studio.json'
    report = json.loads(manifest.read_text(encoding='utf-8'))
    for record in report['fonts']:
        data = (static / record['file']).read_bytes()
        if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
            raise ValueError(f"Shipped font differs from its build record: {record['file']}")
        if record['unchanged'] and record['sha256'] != record['source_sha256']:
            raise ValueError(f"Unchanged font differs from its pinned source: {record['file']}")
    required = ui_characters(static)
    with TTFont(static / 'MiSans-Regular.woff2') as font:
        available = set(font.getBestCmap())
    if not required <= available:
        missing = ''.join(map(chr, sorted(required - available)))
        raise ValueError(f'MiSans does not cover the interface: {missing}')
    report['ui_cjk_unicodes'] = sorted(required)
    report['coverage_check'] = dict(method='Verified shipped font hashes and MiSans cmap; font bytes unchanged',
                                  fonttools=importlib.metadata.version('fonttools'), characters=len(required))
    manifest.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report

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
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--source-dir',type=Path)
    mode.add_argument('--verify-coverage',action='store_true',help='Check shipped font hashes and cmap, then refresh copy coverage without rebuilding fonts')
    args=parser.parse_args()
    if args.verify_coverage:
        report=refresh_coverage()
        print(json.dumps(report['coverage_check']))
    else:
        build(args.source_dir)
