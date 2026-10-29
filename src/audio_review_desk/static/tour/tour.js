import { copy } from './tour-copy.js?v=0.13.0';
import { createMusicPlayer } from './music-player.js?v=0.13.0';
import { sampleSignal, signalPeaks, sampleDuration, moveSampleEdge } from './studio-signal.js';
import { mountSignalStage } from './signal-stage.js?v=0.13.0';

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const releaseURL = 'https://github.com/FUN-ACTION/audio-review-desk/releases/latest';
let language = navigator.language.startsWith('zh') ? 'zh' : 'en';
try { language = localStorage.getItem('ard-tour-language') || language; } catch {}
if (!copy[language]) language = 'en';
const t = key => copy[language][key] || key;
let userPaused = new URLSearchParams(location.search).get('motion') === 'off' ? true : null;
const stage = mountSignalStage($('heroStage'), { paused: userPaused ?? reduced.matches });
let examples;
const music = createMusicPlayer({
  onChange: paintMusic,
  onLevel: level => stage.setAudioLevel(level),
  onError: () => { $('musicError').textContent = t('fileError'); $('musicError').hidden = false; },
});
function paintMusic(state = music.state) {
  const active = state.playing || state.pending;
  $('musicPlay').setAttribute('aria-pressed', String(active));
  $('musicPlay').setAttribute('aria-label', t(active ? 'pause' : 'listen'));
  $('musicLabel').textContent = t(active ? 'pause' : 'listen');
  document.querySelector('.music-icon').textContent = active ? 'Ⅱ' : '▶';
  $('musicName').textContent = state.name || t('soundLabel');
  $('resetMusic').hidden = !state.name;
}
function paintMotion() {
  const paused = userPaused ?? reduced.matches;
  stage.setPaused(paused);
  $('motionToggle').setAttribute('aria-pressed', String(paused));
  $('motionToggle').setAttribute('aria-label', t(paused ? 'playMotion' : 'pauseMotion'));
}
$('motionToggle').addEventListener('click', () => {
  userPaused = !(userPaused ?? reduced.matches); paintMotion();
});
$('musicPlay').addEventListener('click', () => {
  examples?.pause(); $('musicError').hidden = true; music.toggle();
});
$('chooseMusic').addEventListener('click', () => $('musicFile').click());
$('musicFile').addEventListener('change', () => {
  const file = $('musicFile').files[0];
  if (file) { examples?.pause(); music.selectFile(file); $('musicError').hidden = true; }
  $('musicFile').value = '';
});
$('resetMusic').addEventListener('click', () => { music.reset(); $('musicError').hidden = true; });
function translate() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.querySelector('.nav-inner').setAttribute('aria-label', t('navigation'));
  document.querySelectorAll('[data-copy]').forEach(element => { element.textContent = t(element.dataset.copy); });
  document.querySelectorAll('[data-placeholder]').forEach(element => { element.placeholder = t(element.dataset.placeholder); });
  document.querySelectorAll('[data-open]').forEach(link => {
    link.href = local ? '/' : releaseURL;
    link.textContent = t(local ? 'open' : 'get');
  });
  $('languageToggle').textContent = language === 'zh' ? 'EN' : '中文';
  $('languageToggle').setAttribute('aria-label', t('language'));
  $('heroStage').setAttribute('aria-label', t('heroLabel'));
  $('installHint').textContent = t(local ? 'localReady' : 'installBody');
  paintMusic(); paintMotion(); examples?.translate();
}
$('languageToggle').addEventListener('click', () => {
  language = language === 'zh' ? 'en' : 'zh';
  try { localStorage.setItem('ard-tour-language', language); } catch {}
  translate();
});
reduced.addEventListener('change', paintMotion);

function mountExamples() {
  const cards = [...document.querySelectorAll('[data-example]')].map(root => ({
    root, kind: root.dataset.example, variant: 'a', time: root.dataset.example === 'range' ? 3 : 0,
    range: [3, 6.2], loop: root.dataset.example === 'range', notes: [],
    canvas: root.querySelector('canvas'), seek: root.querySelector('.sample-seek'),
    play: root.querySelector('.sample-play'), timeLabel: root.querySelector('.sample-time'),
  }));
  const signals = new Map(), peaks = new Map(), buffers = new Map();
  let context, source, gain, playing = null, pending = null, generation = 0, frame = 0, anchor = 0, offset = 0, disposed = false;
  for (const variant of ['a','b']) {
    const signal = sampleSignal(22050, variant);
    signals.set(variant, signal); peaks.set(variant, signalPeaks(signal, 120));
  }
  const precise = value => {
    const centiseconds = Math.round(value * 100);
    return `${Math.floor(centiseconds / 6000)}:${Math.floor(centiseconds / 100 % 60).toString().padStart(2,'0')}.${(centiseconds % 100).toString().padStart(2,'0')}`;
  };
  const clock = value => `0:${Math.floor(value).toString().padStart(2,'0')}`;
  function currentTime() {
    if (!playing || !context) return playing?.time || 0;
    const elapsed = Math.max(0, context.currentTime - anchor);
    if (playing.kind === 'range' && playing.loop) {
      const [start, end] = playing.range;
      return start + ((offset - start + elapsed) % (end - start) + end - start) % (end - start);
    }
    return Math.min(sampleDuration, offset + elapsed);
  }
  function draw(card) {
    const canvas = card.canvas, rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(2, devicePixelRatio || 1);
    const width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const left = card.kind === 'range' ? card.range[0] / sampleDuration : 0;
    const right = card.kind === 'range' ? card.range[1] / sampleDuration : 1;
    if (card.kind === 'range') {
      ctx.fillStyle = '#eaf4ff'; ctx.fillRect(width * left, 5 * ratio, width * (right - left), height - 10 * ratio);
    }
    const values = peaks.get(card.variant);
    const step = width / values.length;
    const progress = card.time / sampleDuration;
    values.forEach((peak, index) => {
      const u = index / (values.length - 1);
      const selected = u >= left && u <= right;
      ctx.fillStyle = selected ? (card.variant === 'a' ? '#0071e3' : '#7860cc') : '#d5dce5';
      ctx.globalAlpha = selected && u > progress ? .65 : 1;
      const barHeight = Math.max(2 * ratio, Math.min(1, peak * 2.0) * (height - 30 * ratio));
      ctx.beginPath();
      ctx.roundRect(index * step, (height - barHeight) / 2, Math.max(1.2 * ratio, step * .50), barHeight, 1.2 * ratio);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (card.kind === 'range') {
      ctx.strokeStyle = '#0071e3'; ctx.lineWidth = ratio;
      for (const edge of card.range) { ctx.beginPath(); ctx.moveTo(edge / sampleDuration * width, 5 * ratio); ctx.lineTo(edge / sampleDuration * width, height - 5 * ratio); ctx.stroke(); }
    }
    if (card.time > 0) {
      ctx.fillStyle = '#1d1d1f'; ctx.fillRect(progress * width, 8 * ratio, ratio, height - 16 * ratio);
    }
    if (card.kind === 'notes') {
      for (const note of card.notes) {
        ctx.fillStyle = '#0071e3';
        ctx.beginPath(); ctx.arc(note.at / sampleDuration * width, 6 * ratio, 3 * ratio, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  function paint(card) {
    const active = playing === card || pending === card;
    card.play.setAttribute('aria-pressed', String(active));
    card.play.setAttribute('aria-label', t(active ? 'pauseClip' : 'playClip'));
    card.seek.value = card.time;
    card.timeLabel.textContent = `${clock(card.time)} / 0:12`;
    if (card.kind === 'range') {
      card.root.querySelector('.range-start').value = card.range[0];
      card.root.querySelector('.range-end').value = card.range[1];
      card.root.querySelector('.range-start-value').textContent = card.range[0].toFixed(2) + ' s';
      card.root.querySelector('.range-end-value').textContent = card.range[1].toFixed(2) + ' s';
    }
    draw(card);
  }
  function detachSource() {
    if (source) {
      const oldSource = source, oldGain = gain;
      oldSource.onended = null; source = gain = null;
      try {
        oldGain.gain.cancelScheduledValues(context.currentTime);
        oldGain.gain.setTargetAtTime(0, context.currentTime, .003);
        oldSource.stop(context.currentTime + .015);
      } catch {}
      oldSource.onended = () => { oldSource.disconnect(); oldGain.disconnect(); };
    }
  }
  function pause() {
    generation++;
    if (playing) playing.time = currentTime();
    const previous = playing || pending;
    playing = pending = null; detachSource();
    cancelAnimationFrame(frame); frame = 0;
    if (previous) paint(previous);
  }
  function animate() {
    frame = 0;
    if (!playing || disposed) return;
    playing.time = currentTime(); paint(playing);
    frame = requestAnimationFrame(animate);
  }
  async function play(card) {
    pause(); music.pause();
    const ticket = ++generation;
    pending = card; paint(card);
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw Error('audio unavailable');
      context ||= new Context();
      await context.resume();
      if (disposed || ticket !== generation) return;
      if (!buffers.has(card.variant)) {
        const data = signals.get(card.variant);
        const buffer = context.createBuffer(1, data.length, 22050);
        buffer.copyToChannel(data, 0); buffers.set(card.variant, buffer);
      }
      if (card.time >= sampleDuration - .015 || (card.kind === 'range' && (card.time < card.range[0] || card.time >= card.range[1]))) {
        card.time = card.kind === 'range' ? card.range[0] : 0;
      }
      source = context.createBufferSource(); gain = context.createGain();
      source.buffer = buffers.get(card.variant);
      gain.gain.value = 0; gain.gain.setTargetAtTime(.72, context.currentTime, .004);
      source.connect(gain); gain.connect(context.destination);
      source.loop = card.kind === 'range' && card.loop;
      if (source.loop) { source.loopStart = card.range[0]; source.loopEnd = card.range[1]; }
      source.onended = () => {
        if (ticket !== generation || disposed) return;
        card.time = currentTime();
        source.disconnect(); gain.disconnect(); source = gain = null;
        pause();
      };
      offset = card.time; anchor = context.currentTime;
      pending = null; playing = card;
      if (card.kind === 'range' && !card.loop) source.start(0, offset, card.range[1] - offset);
      else source.start(0, offset);
      $('sampleError').hidden = true; paint(card); frame = requestAnimationFrame(animate);
    } catch {
      if (ticket !== generation || disposed) return;
      pause(); $('sampleError').textContent = t('audioError'); $('sampleError').hidden = false;
    }
  }
  function renderNotes(card) {
    const list = card.root.querySelector('.sample-notes');
    list.replaceChildren();
    if (!card.notes.length) { const empty = document.createElement('p'); empty.className = 'no-notes'; empty.textContent = t('noNotes'); list.append(empty); return; }
    for (const note of card.notes) {
      const row = document.createElement('div'); row.className = 'sample-note';
      const position = document.createElement('button'); position.type = 'button'; position.textContent = precise(note.at);
      position.addEventListener('click', () => { const active = playing === card; if (active) pause(); card.time = note.at; paint(card); if (active) play(card); });
      const text = document.createElement('p'); text.textContent = note.text;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-note'; remove.textContent = '×'; remove.setAttribute('aria-label', t('removeNote'));
      remove.addEventListener('click', () => { card.notes = card.notes.filter(item => item !== note); renderNotes(card); draw(card); card.root.querySelector('.note-input').focus(); });
      row.append(position, text, remove); list.append(row);
    }
  }
  for (const card of cards) {
    card.play.addEventListener('click', () => { if (playing === card || pending === card) pause(); else play(card); });
    card.seek.addEventListener('input', () => {
      const requestedTime = Number(card.seek.value);
      const active = playing === card; if (active || pending === card) pause();
      card.time = requestedTime; paint(card); if (active) play(card);
    });
    card.root.querySelectorAll('[data-variant]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.variant === card.variant) return;
      const active = playing === card; if (active || pending === card) pause();
      card.variant = button.dataset.variant;
      card.root.querySelectorAll('[data-variant]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      paint(card); if (active) play(card);
    }));
    if (card.kind === 'range') {
      for (const edge of ['start','end']) card.root.querySelector('.range-' + edge).addEventListener('input', event => {
        const requestedEdge = Number(event.target.value);
        const active = playing === card; if (active || pending === card) pause();
        card.range = moveSampleEdge(...card.range, edge, requestedEdge);
        card.time = Math.max(card.range[0], Math.min(card.range[1] - .01, card.time));
        paint(card); if (active) play(card);
      });
      card.root.querySelector('.sample-loop').addEventListener('change', event => {
        const active = playing === card; if (active || pending === card) pause();
        card.loop = event.target.checked; if (active) play(card);
      });
    }
    if (card.kind === 'notes') card.root.querySelector('.note-form').addEventListener('submit', event => {
      event.preventDefault();
      const input = card.root.querySelector('.note-input'), text = input.value.trim();
      if (!text || card.notes.length >= 20) return;
      card.notes.push({ at: playing === card ? currentTime() : card.time, text: text.slice(0,120) });
      card.notes.sort((a,b) => a.at - b.at); input.value = ''; renderNotes(card); draw(card);
    });
    paint(card);
  }
  const observer = new ResizeObserver(() => cards.forEach(draw));
  cards.forEach(card => observer.observe(card.canvas));
  const visibility = () => { if (document.hidden) pause(); };
  document.addEventListener('visibilitychange', visibility);
  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) if (!entry.isIntersecting && (playing?.root === entry.target || pending?.root === entry.target)) pause();
  });
  cards.forEach(card => intersection.observe(card.root));
  return {
    pause,
    translate() {
      cards.forEach(card => {
        card.seek.setAttribute('aria-label', t('seek'));
        card.root.querySelector('.range-start')?.setAttribute('aria-label', t('start'));
        card.root.querySelector('.range-end')?.setAttribute('aria-label', t('end'));
        card.root.querySelector('.note-input')?.setAttribute('aria-label', t('noteLabel'));
        card.root.querySelector('.note-add')?.setAttribute('aria-label', t('addNote'));
        if (card.kind === 'notes') renderNotes(card); paint(card);
      });
    },
    dispose() { disposed = true; pause(); observer.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', visibility); context?.close().catch(() => {}); },
  };
}
examples = mountExamples();
const heroVisibility = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) music.pause(); });
heroVisibility.observe($('heroStage'));
const pageVisibility = () => { if (document.hidden) music.pause(); };
document.addEventListener('visibilitychange', pageVisibility);
const revealObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) { entry.target.dataset.reveal = 'visible'; revealObserver.unobserve(entry.target); }
}, { threshold: .08 });
if (!reduced.matches) document.querySelectorAll('.section-heading,.feature-card,.tools-grid article,.download-copy').forEach(element => {
  element.classList.add('reveal'); element.dataset.reveal = 'pending'; revealObserver.observe(element);
});
window.addEventListener('pagehide', event => {
  if (event.persisted) { music.pause(); examples.pause(); return; }
  music.dispose(); examples.dispose(); stage.dispose(); revealObserver.disconnect(); heroVisibility.disconnect();
  document.removeEventListener('visibilitychange', pageVisibility); reduced.removeEventListener('change', paintMotion);
});
translate();
