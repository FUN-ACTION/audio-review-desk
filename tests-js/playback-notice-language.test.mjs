import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {words} from '../src/audio_review_desk/static/copy.js';
import {errorText} from '../src/audio_review_desk/static/errors.js';
const source=readFileSync(new URL('../src/audio_review_desk/static/workbench.js',import.meta.url),'utf8');
const nativeError=source.match(/player\.addEventListener\("error", \(\) => \{([\s\S]*?)\n\}\);/)[1];
const notice=source.slice(source.indexOf('function notice('),source.indexOf('\nasync function request('));
const translate=source.slice(source.indexOf('function translate()'),source.indexOf('\nfor (const name of issueNames)'));
const callbacks=[...source.matchAll(/on(?:Error|RangeUnavailable): \(\) => (notice\([^\n]+\)),/g)].filter(m=>/audioError|loopUnavailable|auditionUnavailable/.test(m[1])).map(m=>m[1]);
function fixture(language='en'){
 const nodes=new Map(),timers=new Map();let serial=0,clears=0,reveals=0;
 const env={validateNote:()=>{},savingReview:null,dirty:false,language,errorText,importDialogGeneration:0,importDialogClosing:false,selected:null,noticeGeneration:0,noticeTimer:null,noticeResolver:null,
 document:{documentElement:{},querySelectorAll:()=>[]},spectrumView:{setLanguage(){}},state:null,job:null,markersView:null,transport:{refresh(){}},updateLibraryToggle(){},draftSession:null,
 reveal(){reveals++;},clearTimeout(id){clears++;timers.delete(id);},setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,delay});return id;}};
 env.$=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,dataset:{},textContent:'',classList:{toggle(){}},setAttribute(){},querySelectorAll:()=>[]});return nodes.get(id);};
 env.t=key=>words[env.language][key];vm.createContext(env);vm.runInContext(notice+'\n'+translate,env);
 return {env,timers,node:env.$('notice'),run:code=>vm.runInContext(code,env),get clears(){return clears;},get reveals(){return reveals;},change(language){env.language=language;vm.runInContext('translate()',env);}};
}
test('audition, transport and unavailable-loop hooks all retain localized notice ownership',()=>{assert.equal(callbacks.length,4);});
for(const [index,callback] of callbacks.entries())for(const initial of ['en','zh'])test(`playback notice hook ${index} follows language from ${initial} without resetting state`,()=>{
 const f=fixture(initial),key=callback.match(/t\("([^"]+)"\)/)[1];f.run(callback);
 const generation=f.env.noticeGeneration,clears=f.clears,reveals=f.reveals;
 assert.equal(f.node.textContent,words[initial][key]);assert.equal(f.node.hidden,false);
 const next=initial==='en'?'zh':'en';f.change(next);assert.equal(f.node.textContent,words[next][key]);assert.equal(f.node.hidden,false);
 f.change(initial);assert.equal(f.node.textContent,words[initial][key]);assert.equal(f.env.noticeGeneration,generation);assert.equal(f.clears,clears);assert.equal(f.reveals,reveals);assert.equal(f.timers.size,0);
});
test('a cleared playback error does not reappear after changing language',()=>{
 const f=fixture();f.run(callbacks[0]);f.run('notice()');f.change('zh');assert.equal(f.node.hidden,true);assert.equal(f.node.textContent,'');assert.equal(f.env.noticeResolver,null);
});
test('a newer unrelated notice replaces translation ownership without changing its success timer',()=>{
 const f=fixture();f.run(callbacks[0]);f.run('notice("Saved latest edit", true)');const timers=[...f.timers];const generation=f.env.noticeGeneration;f.change('zh');
 assert.equal(f.node.textContent,'Saved latest edit');assert.deepEqual([...f.timers],timers);assert.equal(f.env.noticeGeneration,generation);
 timers[0][1].fn();f.change('en');assert.equal(f.node.hidden,true);assert.equal(f.node.textContent,'');
});
test('latest loop error replaces earlier playback text and cleared old text stays retired',()=>{
 const f=fixture();f.run(callbacks[0]);f.run(callbacks.find(c=>c.includes('loopUnavailable')));f.change('zh');assert.equal(f.node.textContent,words.zh.loopUnavailable);f.run('notice()');f.change('en');assert.equal(f.node.hidden,true);
});

for(const initial of ['en','zh'])test(`native media error remains translated from ${initial}`,()=>{
 const f=fixture(initial);f.env.selected={quality:{decoded:true}};f.run(nativeError);assert.equal(f.node.textContent,words[initial].audioError);
 f.change(initial==='en'?'zh':'en');assert.equal(f.node.textContent,words[f.env.language].audioError);assert.equal(f.node.hidden,false);
});
test('native media error without a decoded selection does not replace an existing notice',()=>{
 const f=fixture();f.run('notice("Keep current status")');for(const selected of [null,{quality:{decoded:false}}]){f.env.selected=selected;f.run(nativeError);assert.equal(f.node.textContent,'Keep current status');}
});
test('a new playback error cancels the old success dismissal timer',()=>{
 const f=fixture();f.run('notice("Saved", true)');assert.equal(f.timers.size,1);f.run(callbacks[0]);assert.equal(f.timers.size,0);
 f.change('zh');assert.equal(f.node.textContent,words.zh.audioError);assert.equal(f.node.hidden,false);assert.equal(f.timers.size,0);
});

const recoveryNotices = ['recoveryRestored', 'recoveryCleared'].map(key => {
 const expression = source.match(new RegExp('notice\\([^\\n]*t\\("' + key + '"\\)[^\\n]*\\)'))?.[0];
 assert.ok(expression, `Production recovery notice exists: ${key}`);
 return { key, expression };
});
for (const { key, expression } of recoveryNotices) {
 for (const initial of ['en', 'zh']) test(`${key} follows language without changing notification ownership (${initial})`, () => {
  const f = fixture(initial); f.run(expression);
  const generation = f.env.noticeGeneration, clears = f.clears, reveals = f.reveals;
  assert.equal(f.node.textContent, words[initial][key]); assert.equal(f.node.hidden, false);
  f.change(initial === 'en' ? 'zh' : 'en'); assert.equal(f.node.textContent, words[f.env.language][key]);
  f.change(initial); assert.equal(f.node.textContent, words[initial][key]);
  assert.equal(f.env.noticeGeneration, generation); assert.equal(f.clears, clears); assert.equal(f.reveals, reveals);
  assert.equal(f.timers.size, 0);
 });
 test(`${key} cannot return after a newer error or an explicit clear`, () => {
  const f = fixture(); f.run(expression); f.run(callbacks[0]); f.change('zh');
  assert.equal(f.node.textContent, words.zh.audioError);
  f.run(expression); f.run('notice()'); f.change('en');
  assert.equal(f.node.hidden, true); assert.equal(f.node.textContent, '');
 });
 test(`${key} cancels the preceding success dismissal timer`, () => {
  const f = fixture(); f.run('notice("Saved", true)'); assert.equal(f.timers.size, 1);
  f.run(expression); assert.equal(f.timers.size, 0); f.change('zh');
  assert.equal(f.node.hidden, false); assert.equal(f.node.textContent, words.zh[key]);
 });
}

for (const initial of ['en', 'zh']) for (const code of ['', 'source_missing']) {
 test(`earlier import status inside the modal follows language (${initial}, ${code || 'started'})`, () => {
  const f = fixture(initial), status = f.env.$('importPreviousStatus');
  status.hidden = false; status.dataset.result = code ? 'failed' : 'started'; status.dataset.code = code;
  f.env.$('importPath').value = '/new/input.wav';
  f.change(initial);
  const expected = language => code ? `${words[language].importEarlierFailed} ${errorText({ code }, language)}` : words[language].importEarlierStarted;
  assert.equal(status.textContent, expected(initial));
  const next = initial === 'en' ? 'zh' : 'en'; f.change(next);
  assert.equal(status.textContent, expected(next)); assert.equal(status.hidden, false);
  assert.equal(f.env.$('importPath').value, '/new/input.wav'); assert.equal(f.env.$('importError').hidden, true);
 });
}
test('earlier import status is a distinct polite live region inside the import dialog', () => {
 const html = readFileSync(new URL('../src/audio_review_desk/static/workbench.html', import.meta.url), 'utf8');
 const dialog = html.slice(html.indexOf('<dialog id="importDialog"'), html.indexOf('<dialog id="helpDialog"'));
 assert.match(dialog, /id="importPreviousStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
 assert.match(dialog, /id="importError"[^>]*role="alert"/);
 const region = dialog.match(/<div id="importPreviousStatus"[^>]*>/)[0];
 assert.doesNotMatch(region, /\shidden(?:\s|>)/);
});

test('cleared persistent import region does not invent a started message during translation', () => {
 const f = fixture(), status = f.env.$('importPreviousStatus');
 status.hidden = false; status.dataset.result = ''; status.textContent = '';
 f.change('zh'); assert.equal(status.textContent, '');
});
for (const code of ['', 'source_missing']) test(`closed-dialog import notice retains translation and replacement ownership (${code || 'started'})`, () => {
 const f = fixture(), start = source.indexOf('function showPreviousImportResult(');
 const callback = source.slice(start, source.indexOf('// A native picker can return paths', start));
 f.env.$('importDialog').open = false;
 f.run(callback); f.env.failure = code ? { code } : null; f.run('showPreviousImportResult(failure)');
 const expected = language => code ? `${words[language].importEarlierFailed} ${errorText({ code }, language)}` : words[language].importEarlierStarted;
 assert.equal(f.node.textContent, expected('en')); f.change('zh'); assert.equal(f.node.textContent, expected('zh'));
 f.run('notice("Newer status")'); f.change('en'); assert.equal(f.node.textContent, 'Newer status');
});

const languageStart = source.indexOf('$("language").addEventListener("change", () => {') + '$("language").addEventListener("change", () => {'.length;
const languageChange = source.slice(languageStart, source.indexOf('\n});\n$("refresh").addEventListener', languageStart));
for (const callback of callbacks) for (const initial of ['en', 'zh']) test(`real language-change handler preserves localized notices and ownership (${initial}, ${callback})`, () => {
 const key = callback.match(/t\("([^"]+)"\)/)[1];
 const f = fixture(initial); f.run(callback); const generation = f.env.noticeGeneration;
 const next = initial === 'en' ? 'zh' : 'en'; f.env.$('language').value = next; f.run(languageChange);
 assert.equal(f.node.hidden, false); assert.equal(f.node.textContent, words[next][key]);
 assert.equal(f.env.noticeGeneration, generation);
});
test('real language-change handler preserves pending feedback ownership while clearing fixed-language text', () => {
 const f = fixture(); f.run('notice("Fixed language text")'); const generation = f.env.noticeGeneration;
 f.env.$('language').value = 'zh'; f.run(languageChange);
 assert.equal(f.node.hidden, true); assert.equal(f.node.textContent, ''); assert.equal(f.env.noticeGeneration, generation);
});
test('real language-change handler keeps the localized success dismissal timer', () => {
 const f = fixture(); f.run('notice(() => t("recoveryCleared"), true)');
 const timers = [...f.timers], generation = f.env.noticeGeneration;
 f.env.$('language').value = 'zh'; f.run(languageChange);
 assert.equal(f.node.textContent, words.zh.recoveryCleared); assert.deepEqual([...f.timers], timers);
 assert.equal(f.env.noticeGeneration, generation);
});

for (const initial of ['en', 'zh']) for (const result of ['failed', 'started']) {
 test(`last submission receipt follows the actual language-change handler (${initial}, ${result})`, () => {
  const f = fixture(initial), receipt = f.env.$('importSubmissionReceipt');
  receipt.hidden = false; receipt.dataset.result = result; receipt.dataset.code = result === 'failed' ? 'network' : '';
  const next = initial === 'en' ? 'zh' : 'en'; f.env.$('language').value = next; f.run(languageChange);
  const expected = result === 'failed' ? `${words[next].importReceiptFailed} ${errorText({ code: 'network' }, next)}` : words[next].importReceiptStarted;
  assert.equal(f.env.$('importSubmissionReceiptText').textContent, expected);
  assert.equal(receipt.hidden, false); assert.equal(receipt.dataset.result, result);
 });
}
test('last submission feedback is an independent disclosure rather than a current-input error', () => {
 const html = readFileSync(new URL('../src/audio_review_desk/static/workbench.html', import.meta.url), 'utf8');
 const dialog = html.slice(html.indexOf('<dialog id="importDialog"'), html.indexOf('<dialog id="helpDialog"'));
 const receipt = dialog.match(/<details id="importSubmissionReceipt"[\s\S]*?<\/details>/)[0];
 assert.match(receipt, /<summary data-t="importReceiptTitle">/);
 assert.match(receipt, /id="importSubmissionReceiptText"/);
 assert.doesNotMatch(receipt, /role="alert"|<input|<textarea/);
});

test('unconfirmed import feedback offers recovery without assuming a visible or correlated job', () => {
 for (const key of ['importEarlierFailed', 'importReceiptFailed']) {
  assert.match(words.en[key], /confirm/i); assert.match(words.en[key], /Keep a separate copy of your current edits/);
  assert.match(words.en[key], /confirm the app is running, then reload the page/);
  assert.match(words.en[key], /inspect the file list and any visible progress/);
  assert.match(words.en[key], /No progress indicator does not mean the submission was rejected/);
  assert.match(words.en[key], /Do not retry while the outcome is uncertain/);
  assert.doesNotMatch(words.en[key], /import failed|not accepted|not created/i);
  assert.match(words.zh[key], /确认/); assert.match(words.zh[key], /先另行保存当前编辑/);
  assert.match(words.zh[key], /确认应用仍在运行后重新加载页面/);
  assert.match(words.zh[key], /核对文件列表与可见进度/);
  assert.match(words.zh[key], /没有进度并不说明未提交/);
  assert.match(words.zh[key], /无法确认时不要直接重试/);
  assert.doesNotMatch(words.zh[key], /导入失败|未创建/);
 }
 assert.match(words.zh.importReceiptTitle, /已返回/);
 assert.match(words.en.importReceiptTitle, /feedback received/);
});

// Authored but NOT RUN: both rescan views read the same page-only outcome.
for(const outcome of ['accepted','unconfirmed'])for(const initial of ['en','zh'])test(`rescan ${outcome} receipt follows language from ${initial} without changing notices`,()=>{
 const f=fixture(initial);f.env.$('rescanSubmissionReceipt').dataset.outcome=outcome;
 f.run('notice("newer")');const generation=f.env.noticeGeneration;
 f.change(initial==='en'?'zh':'en');const lang=f.env.language;
 for(const id of ['rescanSubmissionReceipt','rescanSubmissionReceiptDialog']){
  assert.equal(f.env.$(id).hidden,false);
  assert.equal(f.env.$(id+'Text').textContent,words[lang][outcome==='accepted'?'rescanReceiptAccepted':'rescanReceiptUnconfirmed']);
 }
 assert.equal(f.node.textContent,'newer');assert.equal(f.env.noticeGeneration,generation);
});

// NOT RUN: a retained receipt must not identify a later task's progress as its own.
test('accepted rescan receipt confirms submission only and disclaims progress association',()=>{
 assert.match(words.en.rescanReceiptAccepted,/does not confirm completion/);
 assert.match(words.en.rescanReceiptAccepted,/not linked to current progress/);
 assert.match(words.en.rescanReceiptAccepted,/may belong to another task/);
 assert.match(words.zh.rescanReceiptAccepted,/不表示完成/);
 assert.match(words.zh.rescanReceiptAccepted,/不说明当前进度/);
 assert.match(words.zh.rescanReceiptAccepted,/当前进度可能是其他任务/);
});

// Lock the user-facing advice, rather than comparing the renderer only with
// whichever copy is currently shipped. These are real production notice hooks.
const neutralPlaybackText = {
 en: 'Playback is temporarily unavailable. Please try again.',
 zh: '暂时无法播放，请重试。',
};
const genericPlaybackHooks = callbacks.filter(callback => callback.includes('t("audioError")'));
test('workbench has exactly two generic playback callbacks plus its native error listener', () => {
 assert.equal(genericPlaybackHooks.length, 2); assert.ok(nativeError.includes('t("audioError")'));
});
for (const [index, hook] of [...genericPlaybackHooks, nativeError].entries()) {
 test(`workbench playback error entry ${index} gives neutral retry advice in both languages`, () => {
  const f = fixture(); f.env.selected = { quality: { decoded: true } }; f.run(hook);
  const generation = f.env.noticeGeneration, resolver = f.env.noticeResolver;
  for (const language of ['en', 'zh', 'en']) {
   f.change(language);
   assert.equal(f.node.textContent, neutralPlaybackText[language]); assert.equal(f.node.hidden, false);
   assert.equal(f.env.noticeGeneration, generation); assert.equal(f.env.noticeResolver, resolver);
   assert.equal(f.timers.size, 0);
  }
 });
}
test('verified source-change error retains specific rescan advice and is not replaced by generic playback copy', () => {
 const f = fixture();
 f.run('notice(() => errorText({ code: "source_changed" }, language))');
 for (const [language, expected] of [
  ['zh', '音频文件已有变化。重新扫描后再审核。'],
  ['en', 'The audio changed. Rescan it before reviewing.'],
 ]) {
  f.change(language); assert.equal(f.node.textContent, expected);
  assert.notEqual(f.node.textContent, neutralPlaybackText[language]);
 }
});
