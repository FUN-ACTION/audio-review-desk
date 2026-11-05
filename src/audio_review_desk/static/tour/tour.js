import { copy } from './tour-copy.js?v=0.14-local';
import { mountReviewTabs, serializeSampleNotes } from './review-tabs.js?v=0.14-editorial';
import { createMusicPlayer } from './music-player.js?v=0.13.0';
import { sampleSignal, signalPeaks, sampleDuration, moveSampleEdge } from './studio-signal.js';
import { mountSignalStage } from './signal-stage.js?v=0.14-editorial';
import { probeLocalWorkspace } from './workspace-link.js';
import { createLocalReviewPlayer, moveLocalEdge, serializeLocalReview } from './local-review.js?v=0.14-local';
import { formatRangeTime, resolveRangeInput } from './range-time.js?v=0.14-time';

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let workspaceReady = false, workspaceProbe = null;
const releaseURL = 'https://github.com/FUN-ACTION/audio-review-desk/releases/latest';
let language = navigator.language.startsWith('zh') ? 'zh' : 'en';
try { language = localStorage.getItem('ard-tour-language') || language; } catch {}
if (!copy[language]) language = 'en';
const t = key => copy[language][key] || key;
let userPaused = new URLSearchParams(location.search).get('motion') === 'off' ? true : null;
const stage = mountSignalStage($('heroStage'), { paused: userPaused ?? reduced.matches, onAvailabilityChange: paintMotionAvailability });
let examples;
const music = createMusicPlayer({
  onChange: paintMusic,
  onLevel: level => stage.setAudioLevel(level),
  onError: (_error, kind) => {
    const key = new Map([['unavailable', 'musicUnavailable'], ['resume', 'musicResumeError'], ['decode', 'musicDecodeError'], ['unsupported', 'musicUnsupported']]).get(kind) || 'musicPlaybackError';
    $('musicError').dataset.errorKey = key; $('musicError').textContent = t(key); $('musicError').hidden = false;
  },
});
function paintMusic(state = music.state) {
  const active = state.playing || state.pending;
  $('musicPlay').setAttribute('aria-pressed', String(active));
  $('musicPlay').setAttribute('aria-label', t(active ? 'pause' : 'listen'));
  $('musicLabel').textContent = t(active ? 'pause' : 'listen');
  $('musicName').textContent = state.name || t('soundLabel');
  $('resetMusic').hidden = !state.name;
}
function paintMotionAvailability(ready) {
  const paused = !ready || (userPaused ?? reduced.matches);
  $('motionToggle').disabled = !ready;
  $('motionToggle').setAttribute('aria-pressed', String(paused));
  $('motionToggle').setAttribute('aria-label', t(!ready ? 'staticMotion' : paused ? 'playMotion' : 'pauseMotion'));
  $('motionToggle').title = t(!ready ? 'staticMotion' : paused ? 'playMotion' : 'pauseMotion');
}
function paintMotion() {
  stage.setPaused(userPaused ?? reduced.matches);
  paintMotionAvailability(stage.ready);
}
$('motionToggle').addEventListener('click', () => {
  userPaused = !(userPaused ?? reduced.matches); paintMotion();
});
$('musicPlay').addEventListener('click', () => {
  examples?.pause(); $('musicError').hidden = true; music.toggle();
});
$('chooseMusic').addEventListener('click', () => $('musicFile').click());
$('reviewChoose').addEventListener('click', () => $('musicFile').click());
$('musicFile').addEventListener('change', () => {
  const file = $('musicFile').files[0];
  $('musicFile').value = '';
  if (file) examples?.selectFile(file);
});
$('resetMusic').addEventListener('click', () => examples?.resetSource());
$('reviewReset').addEventListener('click', () => examples?.resetSource());
$('reviewCancel').addEventListener('click', () => examples?.cancelImport());
function paintWorkspaceLink() {
  document.querySelectorAll('[data-open]').forEach(link => {
    link.href = workspaceReady ? '/' : releaseURL;
    link.textContent = t(workspaceReady ? 'open' : 'get');
  });
  $('installHint').textContent = t(workspaceReady ? 'localReady' : 'installBody');
  $('heroInstallHint').textContent = t(workspaceReady ? 'localReady' : 'installBody');
}
function translate() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.querySelector('.nav-inner').setAttribute('aria-label', t('navigation'));
  document.querySelector('.feature-tabs').setAttribute('aria-label', t('toolTabs'));
  document.querySelectorAll('[data-copy]').forEach(element => { element.textContent = t(element.dataset.copy); });
  document.querySelectorAll('[data-placeholder]').forEach(element => { element.placeholder = t(element.dataset.placeholder); });
  paintWorkspaceLink();
  $('languageToggle').textContent = language === 'zh' ? 'EN' : '中文';
  $('languageToggle').setAttribute('aria-label', t('language'));
  $('heroStage').setAttribute('aria-label', t('heroLabel'));
  if (!$('musicError').hidden) $('musicError').textContent = t($('musicError').dataset.errorKey || 'musicPlaybackError');
  if (!$('sampleError').hidden) $('sampleError').textContent = t($('sampleError').dataset.errorKey || 'audioError');
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
    rangeDraft: false, rangeFeedbackKey: '', rangeInvalid: [],
    canvas: root.querySelector('canvas'), seek: root.querySelector('.sample-seek'),
    play: root.querySelector('.sample-play'), timeLabel: root.querySelector('.sample-time'),
  }));
  const signals = new Map(), peaks = new Map(), buffers = new Map();
  const retiringSources = new Set();
  let context, source, gain, playing = null, pending = null, generation = 0, frame = 0, anchor = 0, offset = 0, disposed = false;
  let duration = sampleDuration, localSource = null, loading = false, importGeneration = 0, sourceStatusKey = '';
  let activeCard = cards[0], localTouched = false, exportedLocalSnapshot = '', requestedLocalSnapshot = '';
  const local = createLocalReviewPlayer({
    onEnded() { if (playing) playing.time = local.time; pause(); },
    onError(key) { pause(); $('sampleError').dataset.errorKey = key; $('sampleError').textContent = t(key); $('sampleError').hidden = false; },
  });
  for (const variant of ['a','b']) {
    const signal = sampleSignal(22050, variant);
    signals.set(variant, signal); peaks.set(variant, signalPeaks(signal, 120));
  }
  const precise = value => {
    const centiseconds = Math.round(value * 100);
    return `${Math.floor(centiseconds / 6000)}:${Math.floor(centiseconds / 100 % 60).toString().padStart(2,'0')}.${(centiseconds % 100).toString().padStart(2,'0')}`;
  };
  const clock = value => `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2,'0')}`;
  function currentTime() {
    if (localSource) return Math.min(duration, Math.max(0, local.time));
    if (!playing || !context) return playing?.time || 0;
    const elapsed = Math.max(0, context.currentTime - anchor);
    if (playing.kind === 'range' && playing.loop) {
      const [start, end] = playing.range;
      return start + ((offset - start + elapsed) % (end - start) + end - start) % (end - start);
    }
    return Math.min(playing.kind === 'range' ? playing.range[1] : duration, offset + elapsed);
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
    const left = card.kind === 'range' ? card.range[0] / duration : 0;
    const right = card.kind === 'range' ? card.range[1] / duration : 1;
    if (card.kind === 'range') {
      ctx.fillStyle = '#f0e4d9'; ctx.fillRect(width * left, 5 * ratio, width * (right - left), height - 10 * ratio);
    }
    // The local path is a time ruler, not invented waveform data. Actual waveform
    // and spectrum analysis remain in the full local workspace.
    const values = localSource ? [] : peaks.get(card.variant);
    if (localSource) {
      ctx.strokeStyle = '#c5c6ba'; ctx.lineWidth = ratio;
      ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
      for (let mark = 0; mark <= 12; mark++) {
        const x = mark / 12 * width, length = (mark % 3 ? 6 : 12) * ratio;
        ctx.beginPath(); ctx.moveTo(x, height / 2 - length); ctx.lineTo(x, height / 2 + length); ctx.stroke();
      }
    }
    const step = width / values.length;
    const progress = card.time / duration;
    values.forEach((peak, index) => {
      const u = index / (values.length - 1);
      const selected = u >= left && u <= right;
      ctx.fillStyle = selected ? (card.variant === 'a' ? '#965438' : '#5d735b') : '#d6d7cb';
      ctx.globalAlpha = selected && u > progress ? .65 : 1;
      const barHeight = Math.max(2 * ratio, Math.min(1, peak * 2.0) * (height - 30 * ratio));
      ctx.beginPath();
      ctx.roundRect(index * step, (height - barHeight) / 2, Math.max(1.2 * ratio, step * .50), barHeight, 1.2 * ratio);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (card.kind === 'range') {
      ctx.strokeStyle = '#965438'; ctx.lineWidth = ratio;
      for (const edge of card.range) { ctx.beginPath(); ctx.moveTo(edge / duration * width, 5 * ratio); ctx.lineTo(edge / duration * width, height - 5 * ratio); ctx.stroke(); }
    }
    if (card.time > 0) {
      ctx.fillStyle = '#24251f'; ctx.fillRect(progress * width, 8 * ratio, ratio, height - 16 * ratio);
    }
    if (card.kind === 'notes') {
      for (const note of card.notes) {
        ctx.fillStyle = '#965438';
        ctx.beginPath(); ctx.arc(note.at / duration * width, 6 * ratio, 3 * ratio, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  function paintRangeInputs(card) {
    for (const [index, edge] of ['start', 'end'].entries()) {
      const input = card.root.querySelector('.range-time-' + edge);
      const value = formatRangeTime(card.range[index]);
      if (!card.rangeDraft && input.value !== value) input.value = value;
      input.disabled = loading;
      input.setAttribute('aria-invalid', String(card.rangeInvalid.includes(edge)));
    }
    card.root.querySelector('.range-time-apply').disabled = loading || !card.rangeDraft;
    card.root.querySelector('.range-time-revert').disabled = loading || !card.rangeDraft;
    const status = card.root.querySelector('.range-time-status');
    const message = card.rangeFeedbackKey ? t(card.rangeFeedbackKey).replace('{duration}', formatRangeTime(duration)).replace('{minimum}', String(Math.min(.25, duration))) : '';
    if (status.textContent !== message) status.textContent = message;
    status.dataset.state = card.rangeInvalid.length ? 'error' : 'ready';
  }
  function paint(card) {
    const active = playing === card || pending === card;
    card.play.setAttribute('aria-pressed', String(active));
    card.play.setAttribute('aria-label', t(active ? 'pauseClip' : 'playClip'));
    card.play.disabled = loading;
    card.seek.disabled = loading;
    card.seek.max = duration;
    card.seek.value = card.time;
    card.seek.setAttribute('aria-valuetext', `${Number(card.time.toFixed(2))} ${t('seconds')}`);
    card.timeLabel.textContent = localSource ? `${precise(card.time)} / ${precise(duration)}` : `${clock(card.time)} / ${clock(duration)}`;
    card.root.querySelectorAll('[data-variant]').forEach(button => {
      button.disabled = loading || (!!localSource && button.dataset.variant === 'b');
      button.setAttribute('aria-pressed', String(button.dataset.variant === card.variant));
    });
    if (card.kind === 'range') {
      const minimum = Math.min(.25, duration);
      card.root.querySelector('.range-start').max = duration - minimum;
      card.root.querySelector('.range-end').min = minimum;
      card.root.querySelector('.range-end').max = duration;
      card.root.querySelector('.range-start').disabled = loading || card.rangeDraft;
      card.root.querySelector('.range-end').disabled = loading || card.rangeDraft;
      card.root.querySelector('.sample-loop').disabled = loading;
      card.root.querySelector('.range-start').value = card.range[0];
      card.root.querySelector('.range-end').value = card.range[1];
      card.root.querySelector('.range-start').setAttribute('aria-valuetext', `${card.range[0].toFixed(3)} ${t('seconds')}`);
      card.root.querySelector('.range-end').setAttribute('aria-valuetext', `${card.range[1].toFixed(3)} ${t('seconds')}`);
      card.root.querySelector('.range-start-value').textContent = card.range[0].toFixed(3) + ' s';
      card.root.querySelector('.range-end-value').textContent = card.range[1].toFixed(3) + ' s';
      paintRangeInputs(card);
    }
    if (card.kind === 'notes') {
      card.root.querySelector('.note-input').disabled = loading;
      card.root.querySelector('.note-add').disabled = loading;
    }
    draw(card);
  }
  function detachSource() {
    if (source) {
      const oldSource = source, oldGain = gain;
      source = gain = null;
      let released = false;
      const release = () => {
        if (released) return;
        released = true; oldSource.onended = null; retiringSources.delete(release);
        try { oldSource.disconnect(); } catch {}
        try { oldGain.disconnect(); } catch {}
      };
      retiringSources.add(release);
      oldSource.onended = release;
      try {
        oldGain.gain.cancelScheduledValues(context.currentTime);
        oldGain.gain.setTargetAtTime(0, context.currentTime, .003);
        oldSource.stop(context.currentTime + .015);
      } catch {
        // A failed fade/stop must not leave an old loop connected and audible.
        try { oldSource.stop(); } catch {}
        release();
      }
      if (disposed) release();
    }
  }
  function pause() {
    generation++;
    if (playing) playing.time = currentTime();
    const previous = playing || pending;
    playing = pending = null; detachSource(); local.pause();
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
    if (loading || disposed) return;
    pause(); music.pause();
    const ticket = ++generation;
    pending = card; paint(card);
    try {
      if (card.time >= duration || (card.kind === 'range' && (card.time < card.range[0] || card.time >= card.range[1]))) {
        card.time = card.kind === 'range' ? card.range[0] : 0;
      }
      if (localSource) {
        const started = await local.play({ at: card.time, start: card.kind === 'range' ? card.range[0] : 0,
          end: card.kind === 'range' ? card.range[1] : duration, loop: card.kind === 'range' && card.loop });
        if (disposed || ticket !== generation) return;
        if (!started) { pause(); return; }
        pending = null; playing = card;
        $('sampleError').hidden = true; paint(card); frame = requestAnimationFrame(animate); return;
      }
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
      pause(); $('sampleError').dataset.errorKey = localSource ? 'localPlaybackError' : 'audioError';
      $('sampleError').textContent = t($('sampleError').dataset.errorKey); $('sampleError').hidden = false;
    }
  }
  function paintNoteFeedback(card) {
    if (['noteExportDraft', 'noteExportLimit'].includes(card.noteFeedbackKey))
      card.noteFeedbackKey = card.root.querySelector('.note-input').value.trim()
        ? (card.notes.length >= 20 ? 'noteExportLimit' : 'noteExportDraft') : '';
    const status = card.root.querySelector('.note-status');
    const message = card.noteFeedbackKey ? t(card.noteFeedbackKey) : '';
    if (status.textContent !== message) status.textContent = message;
    status.dataset.state = message ? 'error' : 'ready';
    card.root.querySelector('.note-input').setAttribute('aria-invalid', String(card.noteFeedbackKey === 'noteRequired'));
  }
  function renderNotes(card) {
    if (card.noteFeedbackKey === 'noteLimit' && card.notes.length < 20) card.noteFeedbackKey = '';
    paintNoteFeedback(card);
    const list = card.root.querySelector('.sample-notes');
    list.replaceChildren();
    card.root.querySelector('.note-count').textContent = card.notes.length >= 20 ? t('noteLimit') : `${card.notes.length} / 20 ${t('noteCount')}`;
    card.root.querySelector('.note-export').disabled = !localSource && !card.notes.length;
    if (!card.notes.length) { const empty = document.createElement('p'); empty.className = 'no-notes'; empty.textContent = t('noNotes'); list.append(empty); return; }
    for (const note of card.notes) {
      const row = document.createElement('div'); row.className = 'sample-note';
      const position = document.createElement('button'); position.type = 'button'; position.textContent = precise(note.at);
      position.setAttribute('aria-label', `${t('seekNote')}: ${precise(note.at)} — ${note.text}`);
      position.disabled = loading;
      position.addEventListener('click', () => { const active = playing === card || pending === card; if (active) pause(); card.time = note.at; paint(card); if (active) play(card); });
      const text = document.createElement('p'); text.textContent = note.text;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-note'; remove.textContent = '×'; remove.setAttribute('aria-label', `${t('removeNote')}: ${precise(note.at)} — ${note.text}`);
      remove.disabled = loading;
      remove.addEventListener('click', () => { if (loading) return; card.notes = card.notes.filter(item => item !== note); localTouched = true; renderNotes(card); draw(card); card.root.querySelector('.note-input').focus(); });
      row.append(position, text, remove); list.append(row);
    }
  }
  for (const card of cards) {
    card.play.addEventListener('click', () => { if (playing === card || pending === card) pause(); else play(card); });
    card.seek.addEventListener('input', () => {
      if (loading) return;
      const requestedTime = Number(card.seek.value);
      const active = playing === card || pending === card; if (active) pause();
      card.time = requestedTime; paint(card); if (active) play(card);
    });
    card.root.querySelectorAll('[data-variant]').forEach(button => button.addEventListener('click', () => {
      if (loading || (localSource && button.dataset.variant === 'b')) return;
      if (button.dataset.variant === card.variant) return;
      const active = playing === card || pending === card; if (active) pause();
      card.variant = button.dataset.variant;
      card.root.querySelectorAll('[data-variant]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      paint(card); if (active) play(card);
    }));
    if (card.kind === 'range') {
      const finishRangeAction = update => {
        const origin = document.activeElement;
        const ownedFocus = ['.range-time-apply', '.range-time-revert'].some(selector => card.root.querySelector(selector) === origin)
          && origin.isConnected && !origin.disabled && origin.getClientRects().length;
        let focusMoved = false;
        const observeFocus = event => { if (event.target !== origin && event.target !== document.body) focusMoved = true; };
        if (ownedFocus) document.addEventListener('focusin', observeFocus);
        try { update(); }
        finally { if (ownedFocus) document.removeEventListener('focusin', observeFocus); }
        const target = card.root.querySelector('.range-time-start');
        if (ownedFocus && !focusMoved && origin.isConnected && origin.disabled && document.activeElement === document.body
            && target.isConnected && !target.disabled && target.getClientRects().length) target.focus({ preventScroll: true });
      };
      const revertDraft = () => {
        if (loading) return;
        finishRangeAction(() => {
          card.rangeDraft = false; card.rangeInvalid = []; card.rangeFeedbackKey = 'rangeInputReverted'; paint(card);
        });
      };
      for (const edge of ['start', 'end']) {
        const input = card.root.querySelector('.range-time-' + edge);
        input.addEventListener('input', () => {
          if (loading) return;
          card.rangeDraft = true; card.rangeInvalid = []; card.rangeFeedbackKey = 'rangeInputDraft'; paint(card);
        });
        input.addEventListener('keydown', event => {
          if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 &&
              !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
            event.preventDefault(); revertDraft();
          }
          if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
        });
      }
      card.root.querySelector('.range-time-revert').addEventListener('click', revertDraft);
      card.root.querySelector('.range-time-form').addEventListener('submit', event => {
        event.preventDefault();
        if (loading || !card.rangeDraft) return;
        const result = resolveRangeInput(card.root.querySelector('.range-time-start').value, card.root.querySelector('.range-time-end').value, duration, card.range);
        if (!result.ok) {
          card.rangeFeedbackKey = result.error; card.rangeInvalid = result.fields; paintRangeInputs(card);
          card.root.querySelector('.range-time-' + result.fields[0]).focus(); return;
        }
        finishRangeAction(() => {
          const changed = result.range.some((value, index) => value !== card.range[index]);
          const active = playing === card || pending === card;
          if (changed && active) pause();
          card.range = result.range; card.rangeDraft = false; card.rangeInvalid = []; card.rangeFeedbackKey = 'rangeInputApplied';
          if (changed) {
            localTouched = true; card.time = Math.max(card.range[0], Math.min(card.range[1] - .01, card.time));
          }
          paint(card); if (changed && active) play(card);
        });
      });
      for (const edge of ['start','end']) card.root.querySelector('.range-' + edge).addEventListener('input', event => {
        if (loading || card.rangeDraft) return;
        const requestedEdge = Number(event.target.value);
        const active = playing === card || pending === card; if (active) pause();
        card.range = localSource ? moveLocalEdge(...card.range, edge, requestedEdge, duration) : moveSampleEdge(...card.range, edge, requestedEdge);
        localTouched = true; card.rangeFeedbackKey = ''; card.rangeInvalid = [];
        card.time = Math.max(card.range[0], Math.min(card.range[1] - .01, card.time));
        paint(card); if (active) play(card);
      });
      card.root.querySelector('.sample-loop').addEventListener('change', event => {
        if (loading) return;
        const active = playing === card || pending === card; if (active) pause();
        card.loop = event.target.checked; if (active) play(card);
      });
    }
    if (card.kind === 'notes') card.root.querySelector('.note-export').addEventListener('click', () => {
      const input = card.root.querySelector('.note-input');
      if (input.value.trim()) {
        card.noteFeedbackKey = card.notes.length >= 20 ? 'noteExportLimit' : 'noteExportDraft';
        paintNoteFeedback(card); input.focus(); return;
      }
      if (!localSource && !card.notes.length) return;
      let url, link;
      requestedLocalSnapshot = '';
      try {
        const content = localSource ? localSnapshot() : serializeSampleNotes(card.notes);
        const blob = new Blob([content], { type: 'application/json' });
        url = URL.createObjectURL(blob); link = document.createElement('a');
        link.href = url; link.download = localSource ? 'audio-review-desk-local-review.json' : 'audio-review-desk-sample-notes.json';
        document.body.append(link); link.click();
        if (localSource) requestedLocalSnapshot = content;
        sourceStatusKey = localSource ? (cards.find(item => item.kind === 'range').rangeDraft ? 'exportAppliedRangeStarted' : 'exportStarted') : 'sampleExportStarted';
        paintSourceStatus();
      } catch {
        sourceStatusKey = 'localExportError';
        paintSourceStatus();
      } finally {
        $('reviewConfirmExport').hidden = !requestedLocalSnapshot;
        link?.remove();
        if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
    if (card.kind === 'notes') card.root.querySelector('.note-input').addEventListener('input', () => {
      if (card.noteFeedbackKey === 'noteRequired' && card.root.querySelector('.note-input').value.trim()) { card.noteFeedbackKey = ''; paintNoteFeedback(card); }
      else if (['noteExportDraft', 'noteExportLimit'].includes(card.noteFeedbackKey)) paintNoteFeedback(card);
    });
    if (card.kind === 'notes') card.root.querySelector('.note-form').addEventListener('submit', event => {
      event.preventDefault();
      if (loading) return;
      const input = card.root.querySelector('.note-input'), text = input.value.trim();
      if (!text || card.notes.length >= 20) {
        card.noteFeedbackKey = !text ? 'noteRequired' : 'noteLimit'; paintNoteFeedback(card); input.focus(); return;
      }
      card.noteFeedbackKey = '';
      card.notes.push({ at: playing === card ? currentTime() : card.time, text: text.slice(0,120) });
      localTouched = true;
      card.notes.sort((a,b) => a.at - b.at); input.value = ''; renderNotes(card); draw(card);
    });
    paint(card);
  }
  $('reviewConfirmExport').addEventListener('click', () => {
    if (!localSource || !requestedLocalSnapshot) return;
    // A click on a download link is not proof of a saved file. Only the user's
    // explicit acknowledgment retires protection for that exact snapshot.
    exportedLocalSnapshot = requestedLocalSnapshot; requestedLocalSnapshot = '';
    sourceStatusKey = 'exportConfirmed';
    paintSource(); $('reviewChoose').focus();
  });
  function paintSourceStatus() {
    const key = loading ? 'localLoading' : sourceStatusKey || (localSource ? 'localAudioReady' : 'localIdle');
    $('reviewSourceStatus').textContent = t(key);
    $('reviewSourceStatus').dataset.state = /Error|Unsupported|Timeout/.test(key) ? 'error' : 'ready';
  }
  function paintSource() {
    const focused = document.activeElement;
    const restoreChooser = !loading && (focused === $('reviewCancel') || (!localSource && focused === $('reviewReset')));
    $('reviewSourceControls').setAttribute('aria-busy', String(loading));
    $('reviewSourceLabel').textContent = t(localSource ? 'localMode' : 'sampleMode');
    $('reviewSourceName').textContent = localSource?.name || 'PIANO STUDY';
    $('reviewSourceName').title = localSource?.name || 'PIANO STUDY';
    $('reviewSourceDuration').textContent = localSource ? precise(duration) : clock(duration);
    $('reviewConfirmExport').hidden = !requestedLocalSnapshot;
    paintSourceStatus();
    $('reviewCancel').hidden = !loading;
    $('reviewReset').hidden = !localSource && !loading;
    $('compareCaption').textContent = t(localSource ? 'localNoReference' : 'compareCaption');
    $('compareTabLabel').textContent = t(localSource ? 'localSingleTitle' : 'compare');
    $('comparePanelTitle').textContent = t(localSource ? 'localSingleTitle' : 'compare');
    $('compareDescription').textContent = t(localSource ? 'localSingleBody' : 'compareBody');
    $('reviewNotice').textContent = t(localSource ? 'localNotice' : 'sampleNotice');
    $('reviewExportLabel').textContent = t(localSource ? 'localExport' : 'exportNotes');
    cards.forEach(card => { paint(card); if (card.kind === 'notes') renderNotes(card); });
    if (restoreChooser) $('reviewChoose').focus();
  }
  function mayReplace() {
    const notes = cards.find(card => card.kind === 'notes');
    const unfinished = !!notes.root.querySelector('.note-input').value.trim() || cards.find(card => card.kind === 'range').rangeDraft;
    const unsaved = localSource ? localTouched && localSnapshot() !== exportedLocalSnapshot : !!notes.notes.length;
    if (!unfinished && !unsaved) return true;
    return typeof window.confirm === 'function' && window.confirm(t('replaceNotesConfirm'));
  }
  function initializeSource(next) {
    localSource = next; duration = next?.duration || sampleDuration;
    localTouched = false; exportedLocalSnapshot = ''; requestedLocalSnapshot = '';
    for (const card of cards) {
      card.variant = 'a'; card.time = next ? 0 : card.kind === 'range' ? 3 : 0;
      card.range = next ? [0, Math.min(duration, 10)] : [3, 6.2]; card.notes = [];
      card.rangeDraft = false; card.rangeInvalid = []; card.rangeFeedbackKey = '';
      if (card.kind === 'notes') { card.root.querySelector('.note-input').value = ''; card.noteFeedbackKey = ''; }
    }
  }
  async function selectFile(file) {
    if (!file || disposed || !mayReplace()) return false;
    const ticket = ++importGeneration;
    pause(); music.pause(); loading = true; sourceStatusKey = 'localLoading';
    $('musicError').hidden = true; paintSource();
    let result;
    try { result = await local.load(file); }
    catch { result = { ok: false, error: 'localUnsupported' }; }
    if (disposed || ticket !== importGeneration) return false;
    loading = false;
    if (result.ok) {
      initializeSource(result.source); sourceStatusKey = '';
      $('sampleError').hidden = true;
      try { music.selectFile(file); }
      catch {
        // The hero's visual player is optional. Its separate media allocation
        // must not strand a file already committed to the listening desk.
        try { music.reset(); } catch {}
        $('musicError').dataset.errorKey = 'localHeroError';
        $('musicError').textContent = t('localHeroError'); $('musicError').hidden = false;
      }
    } else {
      sourceStatusKey = result.cancelled ? 'localLoadCancelled' : result.error;
      if (!result.cancelled) {
        $('musicError').dataset.errorKey = result.error;
        $('musicError').textContent = t(result.error); $('musicError').hidden = false;
      }
    }
    paintSource(); return result.ok;
  }
  function cancelImport() {
    if (!loading) return;
    importGeneration++; local.cancelLoad(); loading = false; sourceStatusKey = 'localLoadCancelled'; paintSource();
  }
  function resetSource() {
    if (disposed || !mayReplace()) return false;
    const restoreHeroChooser = document.activeElement === $('resetMusic');
    importGeneration++; pause(); local.reset(); loading = false; initializeSource(null); sourceStatusKey = '';
    music.reset(); $('musicError').hidden = true; $('sampleError').hidden = true; paintSource();
    if (restoreHeroChooser) $('chooseMusic').focus();
    return true;
  }
  const observer = new ResizeObserver(() => cards.forEach(draw));
  cards.forEach(card => observer.observe(card.canvas));
  const visibility = () => { if (document.hidden) pause(); };
  document.addEventListener('visibilitychange', visibility);
  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) if (!entry.isIntersecting && (playing?.root === entry.target || pending?.root === entry.target)) pause();
  });
  cards.forEach(card => intersection.observe(card.root));
  function localSnapshot() {
    return serializeLocalReview({ name: localSource.name, duration, range: cards.find(card => card.kind === 'range').range,
      notes: cards.find(card => card.kind === 'notes').notes });
  }
  const beforeUnload = event => {
    const notes = cards.find(card => card.kind === 'notes');
    if (cards.find(card => card.kind === 'range').rangeDraft || notes.root.querySelector('.note-input').value.trim()) { event.preventDefault(); event.returnValue = ''; return; }
    if (!localSource) return;
    const content = localSnapshot();
    if (localTouched && content !== exportedLocalSnapshot) {
      event.preventDefault(); event.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
  return {
    pause, selectFile, cancelImport, resetSource,
    show(kind) {
      pause(); const card = cards.find(card => card.kind === kind);
      if (card) { if (localSource) card.time = activeCard.time; activeCard = card; paint(card); }
    },
    translate() {
      cards.forEach(card => {
        card.seek.setAttribute('aria-label', t('seek'));
        card.root.querySelector('.range-start')?.setAttribute('aria-label', t('start'));
        card.root.querySelector('.range-end')?.setAttribute('aria-label', t('end'));
        card.root.querySelector('.note-input')?.setAttribute('aria-label', t('noteLabel'));
        card.root.querySelector('.note-add')?.setAttribute('aria-label', t('addNote'));
        if (card.kind === 'notes') renderNotes(card); paint(card);
      });
      paintSource();
    },
    dispose() { if (disposed) return; disposed = true; importGeneration++; pause(); for (const release of retiringSources) release(); local.dispose(); observer.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('beforeunload', beforeUnload); context?.close().catch(() => {}); },
  };
}
examples = mountExamples();
const reviewTabs = mountReviewTabs(document.querySelector('.review-workbench'), kind => examples.show(kind));
const heroVisibility = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) music.pause(); });
heroVisibility.observe($('heroStage'));
const pageVisibility = () => { if (document.hidden) music.pause(); };
document.addEventListener('visibilitychange', pageVisibility);
const revealObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) { entry.target.dataset.reveal = 'visible'; revealObserver.unobserve(entry.target); }
}, { threshold: .08 });
if (!reduced.matches) document.querySelectorAll('.section-heading,.review-workbench,.tools-grid article,.principles-copy,.principle-list,.download-copy').forEach(element => {
  element.classList.add('reveal'); element.dataset.reveal = 'pending'; revealObserver.observe(element);
});
window.addEventListener('pagehide', event => {
  if (event.persisted) { music.pause(); examples.pause(); return; }
  music.dispose(); examples.dispose(); reviewTabs.dispose(); stage.dispose(); revealObserver.disconnect(); heroVisibility.disconnect();
  document.removeEventListener('visibilitychange', pageVisibility); reduced.removeEventListener('change', paintMotion);
});
function refreshWorkspaceLink() {
  if (workspaceProbe) return workspaceProbe;
  workspaceProbe = probeLocalWorkspace().then(ready => {
    if (workspaceReady !== ready) { workspaceReady = ready; paintWorkspaceLink(); }
  }).finally(() => { workspaceProbe = null; });
  return workspaceProbe;
}
window.addEventListener('focus', refreshWorkspaceLink);
translate();
refreshWorkspaceLink();
