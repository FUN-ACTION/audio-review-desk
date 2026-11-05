import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTrimEditor } from '../src/audio_review_desk/static/trim.js';
import { quietRange } from '../src/audio_review_desk/static/audition.js';
import { words } from '../src/audio_review_desk/static/copy.js';
const source = readFileSync(new URL('../src/audio_review_desk/static/workbench.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/audio_review_desk/static/workbench.html', import.meta.url), 'utf8');
const extract = (start, end) => { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a); return source.slice(a, b); };
const handler = pattern => { const result = source.match(pattern); assert.ok(result); return result[1]; };
function setup({ duration = 10, start = '', end = '', decoded = true } = {}) {
  const nodes = new Map(), noop = () => {}, document = { activeElement: null, documentElement: {}, body: {}, querySelectorAll: () => [], querySelector: () => null };
  function element() { let text = ''; return { value: '', hidden: true, disabled: false, dataset: {}, validity: { badInput: false }, writes: 0,
    get textContent() { return text; }, set textContent(value) { text = value; this.writes++; },
    setCustomValidity: noop, setAttribute: noop, replaceChildren: noop, append: noop, classList: { toggle: noop },
    querySelectorAll: () => [], querySelector: () => null, contains: () => false } }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  document.createElement = element;
  const item = { key: 'a', label: 'Clip', source_id: 'source', source_start: 0, source_end: duration, eligible: true,
    quality: { decoded, duration, flags: [], leading_quiet_seconds: 0.25, trailing_quiet_seconds: 0.5 }, reference_quality: { decoded: true, duration: 2 },
    review: { status: 'pending', version: 0, note: '', issues: [], markers: [], trim_start: start === '' ? null : Number(start), trim_end: end === '' ? null : Number(end) } };
  const env = { $, document, item, words, createTrimEditor, quietRange, Intl,
    number: value => value === '' ? null : Number(value), formatTime: String, precise: String,
    markersView: { refresh: noop, set: noop, get: () => [], hasChanges: () => false },
    reviewPayload: () => ({}), sameReview: () => false, invalidateRefresh: noop,
    draftSession: null, errorText: () => 'error', updateLibraryToggle: noop,
    player: { readyState: 1 }, media: { currentTime: 0, load: noop }, audition: { cancel: noop, check: noop },
    spectrumView: { setVisible: noop, setSource: noop, setLanguage: noop }, waveformView: { cancelDrag() {}, position: noop },
    syncGlider: noop, drawWave: noop, renderWaveStatus: noop, renderSummary: noop, renderQueue: noop,
    renderJob: noop, notice: noop, transport: { refresh: noop }, commandMenu: { refresh: noop },
  };
  const code = [extract('function draftValues()', 'function range()'), extract('function renderDetails(', 'async function select(item'),
    extract('function translate()', 'for (const name of issueNames)'), extract('function updateTime(', 'function drawWave()'),
    extract('async function switchVariant(next)', 'function showImportError(')].join('\n');
  const api = Function(...Object.keys(env), `let savingReview=null, selected=item, state={items:[item]}, busy=false,dirty=false,variant='a',spectrumVisible=false, language='en',job=null,noticeResolver=null;
    const t=key=>words[language][key]||key; const visibleItems=()=>state.items;
    const trimEditor=createTrimEditor({start:$('trimStart'),end:$('trimEnd'),duration:()=>selected.quality.duration,onChange:markDirty});
    ${code}
    renderDetails();
    return { renderDetails, updateTime, switchVariant,
      input(side,value,badInput=false){const node=$(side==='start'?'trimStart':'trimEnd');node.value=value;node.validity.badInput=badInput;document.activeElement=node;markDirty()},
      translateTo(next){language=next;translate()},
      reset(){${handler(/\$\("resetRange"\)\.addEventListener\("click", \(\) => \{([\s\S]*?)\n\}\);/)}},
      suggest(){${handler(/\$\("suggestRange"\)\.addEventListener\("click", \(\) => \{([\s\S]*?)\n\}\);/)}},
      handle(start,end,side){${handler(/onEdit\(start, end, side\) \{([\s\S]*?)\n    \},/)}},
    };`)(...Object.values(env));
  return { ...api, $, item, value: () => $('selectedDuration').textContent };
}

test('blank boundaries display source duration and updates never normalize the fields', () => {
  const h=setup(); assert.equal(h.value(),'10 s'); h.input('start','2'); assert.equal(h.value(),'8 s');
  h.input('end','7.125'); assert.equal(h.value(),'5.125 s'); assert.equal(h.$('trimStart').value,'2'); assert.equal(h.$('trimEnd').value,'7.125');
});
for(const [start,end] of [['-1','5'],['5','5'],['6','5'],['0','11'],['abc','5'],['Infinity',''],['','-1']]) test(`invalid draft ${start}/${end} is unavailable, not playback fallback`,()=>{
 const h=setup();h.input('start',start);h.input('end',end);assert.equal(h.value(),'Unavailable');assert.equal(h.$('trimStart').value,start);assert.equal(h.$('trimEnd').value,end);
});
for(const side of ['start','end']) test(`native incomplete ${side} is not treated as a blank default`,()=>{
 const h=setup();h.input(side,'',true);assert.equal(h.value(),'Unavailable');h.input(side,'',false);assert.equal(h.value(),'10 s');
});
for(const duration of [1/44100,1e-12,Number.MIN_VALUE]) test(`positive duration ${duration} never displays zero`,()=>{
 const h=setup({duration});assert.equal(h.value(),'Less than 0.001 s');h.translateTo('zh');assert.equal(h.value(),'小于 0.001 秒');
});
for(const duration of [NaN,Infinity,0,-1]) test(`invalid source duration ${duration} is unavailable`,()=>{assert.equal(setup({duration}).value(),'Unavailable')});
test('undecoded source has no claimed selected duration',()=>{assert.equal(setup({decoded:false}).value(),'Unavailable')});
test('actual reset, suggestion and handle callbacks update without changing opposite endpoint',()=>{
 const h=setup();h.suggest();assert.equal(h.value(),'9.25 s');h.handle(1.25,9.5,'start');assert.equal(h.value(),'8.25 s');assert.equal(h.$('trimEnd').value,'9.5');h.reset();assert.equal(h.value(),'10 s');assert.equal(h.$('trimStart').value,'');assert.equal(h.$('trimEnd').value,'');
});
test('actual A/B switch retains original-source selected duration and typed draft',async()=>{
 const h=setup();h.input('start','3');h.input('end','8');await h.switchVariant('b');assert.equal(h.value(),'5 s');assert.equal(h.$('trimStart').value,'3');assert.equal(h.$('trimEnd').value,'8');await h.switchVariant('a');assert.equal(h.value(),'5 s');
});
test('actual translation updates invalid draft feedback without resetting its text',()=>{
 const h=setup();h.input('start','12');h.translateTo('zh');assert.equal(h.value(),'不可用');assert.equal(h.$('trimStart').value,'12');h.translateTo('en');assert.equal(h.value(),'Unavailable');
});
test('playback ticks do not rewrite or announce selected duration',()=>{
 const h=setup(), before=h.$('selectedDuration').writes;for(const t of [0,1,2,5])h.updateTime(t);assert.equal(h.$('selectedDuration').writes,before);
 const markup=html.match(/<p class="range-duration">[\s\S]*?<\/p>/)?.[0];assert.ok(markup);assert.doesNotMatch(markup,/aria-live|role="status"|<output/);assert.match(markup,/data-t="selectedDuration"/);
 assert.equal(words.en.selectedDuration,'Selected duration');assert.equal(words.zh.selectedDuration,'所选时长');
});

test('nonzero-start submillisecond selection stays positive without changing exact endpoints',()=>{
 const h=setup();h.input('start','3.125');h.input('end','3.125125');
 assert.equal(h.value(),'Less than 0.001 s');h.translateTo('zh');assert.equal(h.value(),'小于 0.001 秒');
 assert.equal(h.$('trimStart').value,'3.125');assert.equal(h.$('trimEnd').value,'3.125125');
});

test('ordinary fractional duration remains correct through Chinese translation',()=>{
 const h=setup();h.input('start','1.125');h.input('end','8.75');assert.equal(h.value(),'7.625 s');
 h.translateTo('zh');assert.equal(h.value(),'7.625 s');assert.equal(h.$('trimStart').value,'1.125');assert.equal(h.$('trimEnd').value,'8.75');
 h.translateTo('en');assert.equal(h.value(),'7.625 s');
});
