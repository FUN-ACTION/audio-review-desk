import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { probeLocalWorkspace } from "../src/audio_review_desk/static/tour/workspace-link.js";
import { copy } from "../src/audio_review_desk/static/tour/tour-copy.js";

const identity = { application: "audio-review-desk", version: "0.13.0" };
const response = (data = identity, options = {}) => {
  const native = new Response(JSON.stringify(data), { headers: { 'content-length': '64' } });
  return { ok: true, redirected: false, headers: native.headers, body: native.body, ...options };
};
function runtime(href = "http://127.0.0.1:8765/tour/?lang=en", fetcher = async () => response()) {
  const calls = [], timers = new Map(); let next = 0;
  const env = { location: { href }, AbortController,
    fetch(url, options) { calls.push({ url, options }); return fetcher(url, options); },
    setTimeout(callback, delay) { timers.set(++next, { callback, delay }); return next; },
    clearTimeout(id) { timers.delete(id); } };
  return { env, calls, timers, timeout() { const timer = timers.values().next().value; assert.ok(timer); timer.callback(); } };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test("a verified loopback workspace uses only its existing origin and public identity endpoint", async () => {
  for (const href of ["http://127.0.0.1:8765/tour/", "http://localhost:9000/preview/tour/", "https://127.0.0.1:8443/tour/"]) {
    const context = runtime(href);
    assert.equal(await probeLocalWorkspace(context.env), true);
    assert.equal(context.calls.length, 1);
    assert.equal(context.calls[0].url, new URL("/api/version", href).href);
    const options = context.calls[0].options;
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Accept, "application/json");
    assert.equal(context.timers.size, 0);
  }
});

test("public, file and credential-bearing pages never probe a visitor's machine", async () => {
  for (const href of ["https://fun-action.github.io/audio-review-desk/", "https://localhost.example/tour/",
    "file:///tmp/tour/index.html", "file://127.0.0.1/tour/", "http://192.168.1.2/tour/", "http://user:password@127.0.0.1/tour/", "not a URL"]) {
    const context = runtime(href);
    assert.equal(await probeLocalWorkspace(context.env), false, href);
    assert.equal(context.calls.length, 0);
    assert.equal(context.timers.size, 0);
  }
});

test("wrong applications, legacy version-only replies and incomplete identities fail closed", async () => {
  for (const data of [null, {}, { version: "0.13.0" }, { application: "other", version: "0.13.0" },
    { application: "audio-review-desk" }, { ...identity, version: " " }, { ...identity, version: 13 }]) {
    const context = runtime(undefined, async () => response(data));
    assert.equal(await probeLocalWorkspace(context.env), false);
    assert.equal(context.timers.size, 0);
  }
});

test("404, redirect, HTML, oversized or rejected responses keep the download fallback", async () => {
  for (const fetcher of [async () => response(identity, { ok: false }), async () => response(identity, { redirected: true }),
    async () => response(identity, { body: new Response("<html>not JSON").body }),
    async () => response(identity, { headers: { get: () => "4097" }, body: null }),
    async () => { throw new Error("offline"); }, () => { throw new Error("sync failure"); }]) {
    const context = runtime(undefined, fetcher);
    assert.equal(await probeLocalWorkspace(context.env), false);
    assert.equal(context.timers.size, 0);
  }
});

test("request timeout returns false even if a fetch double ignores abort", async () => {
  let resolve;
  const context = runtime(undefined, () => new Promise(done => { resolve = done; }));
  const pending = probeLocalWorkspace(context.env, 25);
  assert.equal(context.timers.values().next().value.delay, 25);
  context.timeout();
  assert.equal(await pending, false);
  assert.equal(context.calls[0].options.signal.aborted, true);
  assert.equal(context.timers.size, 0);
  resolve(response()); await settle();
  assert.equal(await pending, false);
});

test("the deadline remains active while the JSON body is pending", async () => {
  const context = runtime(undefined, async () => response(identity, { body: new ReadableStream({ start() {} }) }));
  const pending = probeLocalWorkspace(context.env);
  await settle(); context.timeout();
  assert.equal(await pending, false);
  assert.equal(context.timers.size, 0);
});

test("browsers missing required fetch or abort support retain fallback without errors", async () => {
  for (const missing of ["fetch", "AbortController"]) {
    const context = runtime(); context.env[missing] = undefined;
    assert.equal(await probeLocalWorkspace(context.env), false);
    assert.equal(context.calls.length, 0);
  }
});

const source = readFileSync(new URL("../src/audio_review_desk/static/tour/tour.js", import.meta.url), "utf8");
function page() {
  const element = () => ({ textContent: "", attributes: {}, dataset: {}, setAttribute(key, value) { this.attributes[key] = value; } });
  const links = [element(), element(), element()], nodes = new Map();
  const env = { language: "en", workspaceReady: false, workspaceProbe: null, local: true,
    releaseURL: "https://github.com/FUN-ACTION/audio-review-desk/releases/latest", copy,
    document: { documentElement: {}, querySelector: () => element(), querySelectorAll: selector => selector === "[data-open]" ? links : [] },
    $: id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    paintMusic() {}, paintMotion() {}, examples: { translate() {} }, probeLocalWorkspace: async () => false };
  env.t = key => copy[env.language][key];
  vm.createContext(env);
  const paintLink = source.match(/function paintWorkspaceLink\(\) \{[\s\S]*?\n\}/)[0];
  const translate = source.match(/function translate\(\) \{[\s\S]*?\n\}/)[0];
  const refresh = source.match(/function refreshWorkspaceLink\(\) \{[\s\S]*?\n\}/)[0];
  vm.runInContext(`${paintLink}\n${translate}\n${refresh}`, env);
  return { env, links, nodes, translate: () => vm.runInContext("translate()", env), refresh: () => vm.runInContext("refreshWorkspaceLink()", env) };
}

test("actual localhost page copy stays on download until identity is verified", async () => {
  const context = page(); context.translate();
  assert.ok(context.links.every(link => link.href === context.env.releaseURL && link.textContent === copy.en.get));
  assert.equal(context.nodes.get("heroInstallHint").textContent, copy.en.installBody);
  await context.refresh();
  assert.ok(context.links.every(link => link.href === context.env.releaseURL));
});

test("verification uses the current language and coalesces overlapping focus checks", async () => {
  const context = page(); let resolve, requests = 0;
  context.env.probeLocalWorkspace = () => { requests++; return new Promise(done => { resolve = done; }); };
  context.translate();
  const first = context.refresh(); assert.equal(context.refresh(), first);
  context.env.language = "zh"; context.translate();
  resolve(true); await first;
  assert.equal(requests, 1);
  assert.ok(context.links.every(link => link.href === "/" && link.textContent === copy.zh.open));
  assert.equal(context.nodes.get("installHint").textContent, copy.zh.localReady);
  assert.equal(context.nodes.get("heroInstallHint").textContent, copy.zh.localReady);
  context.env.probeLocalWorkspace = async () => false;
  await context.refresh();
  assert.ok(context.links.every(link => link.href === context.env.releaseURL && link.textContent === copy.zh.get));
  assert.equal(context.nodes.get("heroInstallHint").textContent, copy.zh.installBody);
});

test("changing language translates visible playback errors without revealing dismissed ones", () => {
  const context = page();
  for (const [id,key] of [["musicError","musicPlaybackError"],["sampleError","audioError"]]) {
    const node = context.env.$(id); node.hidden = false; node.textContent = copy.en[key];
  }
  context.env.language = "zh"; context.translate();
  assert.equal(context.nodes.get("musicError").textContent,copy.zh.musicPlaybackError);
  assert.equal(context.nodes.get("sampleError").textContent,copy.zh.audioError);
  context.env.language = "en"; context.translate();
  assert.equal(context.nodes.get("musicError").textContent,copy.en.musicPlaybackError);
  assert.equal(context.nodes.get("sampleError").textContent,copy.en.audioError);
  context.nodes.get("musicError").hidden = true;
  context.nodes.get("sampleError").hidden = true;
  context.env.language = "en"; context.translate();
  assert.equal(context.nodes.get("musicError").hidden,true);
  assert.equal(context.nodes.get("sampleError").hidden,true);
});

test("local file playback errors retain their source-specific meaning across language changes", () => {
  const context=page(),node=context.env.$('sampleError');
  node.hidden=false;node.dataset.errorKey='localPlaybackError';
  context.env.language='zh';context.translate();
  assert.equal(node.textContent,copy.zh.localPlaybackError);
  context.env.language='en';context.translate();
  assert.equal(node.textContent,copy.en.localPlaybackError);
});


function streamingResponse(chunks, options = {}) {
  let cancelled = 0, reads = 0;
  const queue = chunks.map(chunk => typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
  const body = new ReadableStream({
    pull(controller) { reads++; if (queue.length) controller.enqueue(queue.shift()); else if (!options.stall) controller.close(); },
    cancel() { cancelled++; },
  }, { highWaterMark: 0 });
  return { response: { ok: true, redirected: false, headers: new Headers(options.headers || {}), body }, body,
    get cancelled() { return cancelled; }, get reads() { return reads; } };
}

test('early response rejection cancels the body and aborts the completed probe',async()=>{
  for(const option of [{ok:false},{redirected:true},{headers:new Headers({'content-length':'999999999'})}]){
    const stream=streamingResponse(['x'.repeat(20000)],{stall:true});Object.assign(stream.response,option);
    const context=runtime(undefined,async()=>stream.response);
    assert.equal(await probeLocalWorkspace(context.env),false);assert.equal(stream.cancelled,1);assert.equal(stream.reads,0);
    assert.equal(stream.body.locked,false);assert.equal(context.calls[0].options.signal.aborted,true);assert.equal(context.timers.size,0);
  }
});

test('actual body bytes are bounded even when Content-Length is missing or wrong',async()=>{
  for(const headers of [{},{'content-length':'1'},{'content-length':'not-a-number'}]){
    const stream=streamingResponse([' '.repeat(4096),'x','unused payload'],{headers,stall:true});
    const context=runtime(undefined,async()=>stream.response);
    assert.equal(await probeLocalWorkspace(context.env),false);assert.equal(stream.reads,2);assert.equal(stream.cancelled,1);
    assert.equal(stream.body.locked,false);assert.equal(context.calls[0].options.signal.aborted,true);
  }
});

test('exactly 4096 bytes are accepted and a split multibyte identity remains intact',async()=>{
  const json=JSON.stringify({...identity,version:'版本1'}),raw=new TextEncoder().encode(json);
  const padded=new Uint8Array(4096);padded.fill(32);padded.set(raw);
  const firstNonAscii=raw.findIndex(value=>value>127);
  const stream=streamingResponse([padded.subarray(0,firstNonAscii+1),padded.subarray(firstNonAscii+1)]);
  const context=runtime(undefined,async()=>stream.response);
  assert.equal(await probeLocalWorkspace(context.env),true);assert.equal(stream.body.locked,false);assert.equal(context.timers.size,0);
});

test('byte limit is not bypassed by multibyte text or a single oversized chunk',async()=>{
  for(const chunk of [JSON.stringify({...identity,version:'界'.repeat(1400)}),'x'.repeat(100000)]){
    const stream=streamingResponse([chunk,'unused'],{headers:{'content-length':'100'},stall:true});
    const context=runtime(undefined,async()=>stream.response);assert.equal(await probeLocalWorkspace(context.env),false);
    assert.equal(stream.reads,1);assert.equal(stream.cancelled,1);assert.equal(stream.body.locked,false);
  }
});

test('a pending body is cancelled at the deadline and its lock is released',async()=>{
  const stream=streamingResponse(['{'],{stall:true});const context=runtime(undefined,async()=>stream.response);
  const pending=probeLocalWorkspace(context.env);await settle();context.timeout();assert.equal(await pending,false);await settle();
  assert.equal(stream.cancelled,1);assert.equal(stream.body.locked,false);assert.equal(context.timers.size,0);
});

test('late response after timeout is cancelled without reading or reviving the result',async()=>{
  let resolve;const stream=streamingResponse([JSON.stringify(identity)],{stall:true});
  const context=runtime(undefined,()=>new Promise(done=>{resolve=done;}));const pending=probeLocalWorkspace(context.env);
  context.timeout();assert.equal(await pending,false);resolve(stream.response);await settle();
  assert.equal(stream.reads,0);assert.equal(stream.cancelled,1);assert.equal(stream.body.locked,false);
});

test('unreadable, malformed, non-UTF8 or unsupported streams retain the download fallback',async()=>{
  for(const body of [null,{},new Response('not JSON').body,new Response(new Uint8Array([255,254])).body,
    new ReadableStream({start(controller){controller.error(Error('body failed'));}})]){
    const context=runtime(undefined,async()=>response(identity,{body}));assert.equal(await probeLocalWorkspace(context.env),false);
    assert.equal(context.timers.size,0);assert.equal(context.calls[0].options.signal.aborted,true);
  }
});

test('repeated bounded identity checks leave no active body locks or timers',async()=>{
  for(let index=0;index<300;index++){
    const stream=streamingResponse(index%2?['x'.repeat(5000)]:[JSON.stringify(identity)],{stall:!!(index%2)});
    const context=runtime(undefined,async()=>stream.response);assert.equal(await probeLocalWorkspace(context.env),index%2===0);
    assert.equal(stream.body.locked,false);assert.equal(context.timers.size,0);assert.equal(context.calls[0].options.signal.aborted,true);
  }
});

// Authored after the launcher restriction; NOT RUN. No real fetch/browser used.
test('workspace status transitions repaint only workspace links, while language changes still translate examples',async()=>{
 const context=page();let examples=0,music=0,motion=0;
 context.env.examples.translate=()=>{examples++;};context.env.paintMusic=()=>{music++;};context.env.paintMotion=()=>{motion++;};
 context.translate();assert.deepEqual([examples,music,motion],[1,1,1]);
 for(const ready of [true,false,true]){
  context.env.probeLocalWorkspace=async()=>ready;await context.refresh();
  assert.deepEqual([examples,music,motion],[1,1,1]);
  assert.ok(context.links.every(link=>link.href===(ready?'/':context.env.releaseURL)));
 }
 context.env.language='zh';context.translate();
 assert.deepEqual([examples,music,motion],[2,2,2]);
 assert.ok(context.links.every(link=>link.textContent===copy.zh.open));
 assert.equal(context.nodes.get('heroInstallHint').textContent,copy.zh.localReady);
});
